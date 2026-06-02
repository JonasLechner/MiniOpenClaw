import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AssistantMessage, Message, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type { RuntimePaths } from "./config.js";
import { getAssistantThinkingBlocks, getAssistantVisibleText } from "./messages.js";

export const SESSION_FORMAT_VERSION = 1;

type SessionHeader = {
  type: "session";
  version: typeof SESSION_FORMAT_VERSION;
  sessionId: string;
  createdAt: string;
};

type SessionEventBase = {
  type: string;
  sessionId: string;
  timestamp: string;
};

export type UserMessageEvent = SessionEventBase & {
  type: "user_message";
  message: UserMessage;
};

export type AssistantMessageEvent = SessionEventBase & {
  type: "assistant_message";
  message: AssistantMessage;
  visibleText: string;
  thinking: string[];
};

export type ToolResultMessageEvent = SessionEventBase & {
  type: "tool_result_message";
  message: ToolResultMessage;
};

export type SystemEvent = SessionEventBase & {
  type: "system";
  name: string;
  details?: unknown;
};

export type ErrorEvent = SessionEventBase & {
  type: "error";
  message: string;
  details?: unknown;
};

export type SessionEvent =
  | UserMessageEvent
  | AssistantMessageEvent
  | ToolResultMessageEvent
  | SystemEvent
  | ErrorEvent;

export type Session = {
  sessionId: string;
  createdAt: string;
  path: string;
  events: SessionEvent[];
};

export type SessionSummary = {
  sessionId: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
};

function createSessionId(): string {
  return randomUUID();
}

function createSessionFilePath(paths: RuntimePaths, createdAt: string, sessionId: string): string {
  const fileTimestamp = createdAt.replace(/[:.]/g, "-");
  return join(paths.sessions, `${fileTimestamp}_${sessionId}.jsonl`);
}

function isContextMessageEvent(event: SessionEvent): event is UserMessageEvent | AssistantMessageEvent | ToolResultMessageEvent {
  return event.type === "user_message" || event.type === "assistant_message" || event.type === "tool_result_message";
}

export function getSessionMessages(session: Pick<Session, "events">): Message[] {
  return session.events.filter(isContextMessageEvent).map((event) => event.message);
}

async function ensureSessionsDir(paths: RuntimePaths): Promise<void> {
  await mkdir(paths.sessions, { recursive: true });
}

function toSession(header: SessionHeader, path: string, events: SessionEvent[]): Session {
  return {
    sessionId: header.sessionId,
    createdAt: header.createdAt,
    path,
    events,
  };
}

async function parseSessionFile(path: string): Promise<Session | undefined> {
  let content: string;

  try {
    content = await readFile(path, "utf8");
  } catch {
    return undefined;
  }

  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return undefined;

  const header = JSON.parse(lines[0]) as SessionHeader;
  if (header.type !== "session" || !header.sessionId) return undefined;

  const events: SessionEvent[] = [];

  for (const line of lines.slice(1)) {
    const parsed = JSON.parse(line) as SessionEvent;
    if (parsed.sessionId !== header.sessionId) continue;

    events.push(parsed);
  }

  return toSession(header, path, events);
}

async function getSessionFiles(paths: RuntimePaths): Promise<string[]> {
  await ensureSessionsDir(paths);

  const names = await readdir(paths.sessions);
  const candidates = names.filter((name) => name.endsWith(".jsonl")).map((name) => join(paths.sessions, name));
  const validPaths: string[] = [];

  for (const path of candidates) {
    if (await parseSessionFile(path)) {
      validPaths.push(path);
    }
  }

  const stats = await Promise.all(validPaths.map(async (path) => ({ path, mtimeMs: (await stat(path)).mtimeMs })));
  stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return stats.map((entry) => entry.path);
}

async function appendSessionEvent(session: Session, event: SessionEvent): Promise<void> {
  await writeFile(session.path, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
  session.events.push(event);
}

function formatPromptTimestamp(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function withPromptTimestamp(prompt: string): string {
  return `[${formatPromptTimestamp()}] ${prompt}`;
}

async function createSession(paths: RuntimePaths, details?: unknown): Promise<Session> {
  await ensureSessionsDir(paths);

  const createdAt = new Date().toISOString();
  const sessionId = createSessionId();
  const header: SessionHeader = {
    type: "session",
    version: SESSION_FORMAT_VERSION,
    sessionId,
    createdAt,
  };
  const path = createSessionFilePath(paths, createdAt, sessionId);

  await writeFile(path, `${JSON.stringify(header)}\n`, "utf8");

  const session = toSession(header, path, []);
  await appendSessionEvent(session, {
    type: "system",
    sessionId,
    timestamp: createdAt,
    name: "session_created",
    details,
  });

  return session;
}

export async function ensureCurrentSession(paths: RuntimePaths): Promise<Session> {
  const mostRecentPath = (await getSessionFiles(paths))[0];
  if (!mostRecentPath) {
    return createSession(paths, { reason: "first_use" });
  }

  const session = await parseSessionFile(mostRecentPath);
  if (!session) {
    return createSession(paths, { reason: "recovery_after_invalid_session" });
  }

  return session;
}

export async function createNewSession(paths: RuntimePaths): Promise<Session> {
  return createSession(paths, { reason: "new_session" });
}

export async function listSessions(paths: RuntimePaths): Promise<SessionSummary[]> {
  const sessionFiles = await getSessionFiles(paths);
  const sessions = await Promise.all(sessionFiles.map((path) => parseSessionFile(path)));

  return Promise.all(
    sessions.filter((session): session is Session => session !== undefined).map(async (session) => {
      const stats = await stat(session.path);
      const preview = session.events.find((event) => event.type === "user_message")?.message.content ?? "(no user messages)";

      return {
        sessionId: session.sessionId,
        path: session.path,
        createdAt: session.createdAt,
        updatedAt: stats.mtime.toISOString(),
        messageCount: getSessionMessages(session).length,
        preview: typeof preview === "string" ? preview : JSON.stringify(preview),
      };
    })
  );
}

export async function getSessionById(paths: RuntimePaths, sessionId: string): Promise<Session | undefined> {
  for (const path of await getSessionFiles(paths)) {
    const session = await parseSessionFile(path);
    if (session?.sessionId === sessionId) return session;
  }

  return undefined;
}

export async function appendUserMessageEvent(session: Session, prompt: string): Promise<UserMessageEvent> {
  const message: UserMessage = {
    role: "user",
    content: withPromptTimestamp(prompt),
    timestamp: Date.now(),
  };
  const event: UserMessageEvent = {
    type: "user_message",
    sessionId: session.sessionId,
    timestamp: new Date().toISOString(),
    message,
  };

  await appendSessionEvent(session, event);
  return event;
}

export async function appendAssistantMessageEvent(
  session: Session,
  message: AssistantMessage,
): Promise<AssistantMessageEvent> {
  const event: AssistantMessageEvent = {
    type: "assistant_message",
    sessionId: session.sessionId,
    timestamp: new Date().toISOString(),
    message,
    visibleText: getAssistantVisibleText(message),
    thinking: getAssistantThinkingBlocks(message),
  };

  await appendSessionEvent(session, event);
  return event;
}

export async function appendToolResultMessageEvent(
  session: Session,
  message: ToolResultMessage,
): Promise<ToolResultMessageEvent> {
  const event: ToolResultMessageEvent = {
    type: "tool_result_message",
    sessionId: session.sessionId,
    timestamp: new Date().toISOString(),
    message,
  };

  await appendSessionEvent(session, event);
  return event;
}

export async function appendErrorEvent(session: Session, message: string, details?: unknown): Promise<ErrorEvent> {
  const event: ErrorEvent = {
    type: "error",
    sessionId: session.sessionId,
    timestamp: new Date().toISOString(),
    message,
    details,
  };

  await appendSessionEvent(session, event);
  return event;
}
