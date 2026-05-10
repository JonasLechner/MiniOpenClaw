import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AssistantMessage, Message, UserMessage } from "@earendil-works/pi-ai";
import type { RuntimePaths } from "./config.js";

export const SESSION_FORMAT_VERSION = 1;

export type SessionHeader = {
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

export type SessionEvent = UserMessageEvent | AssistantMessageEvent | SystemEvent | ErrorEvent;

export type SessionRecord = {
  header: SessionHeader;
  path: string;
  events: SessionEvent[];
  messages: Message[];
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

function getVisibleText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function getThinkingBlocks(message: AssistantMessage): string[] {
  return message.content.filter((block) => block.type === "thinking").map((block) => block.thinking);
}

function isContextMessageEvent(event: SessionEvent): event is UserMessageEvent | AssistantMessageEvent {
  return event.type === "user_message" || event.type === "assistant_message";
}

async function ensureSessionsDir(paths: RuntimePaths): Promise<void> {
  await mkdir(paths.sessions, { recursive: true });
}

async function parseSessionFile(path: string): Promise<SessionRecord | undefined> {
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
  const messages: Message[] = [];

  for (const line of lines.slice(1)) {
    const parsed = JSON.parse(line) as SessionEvent;
    if (parsed.sessionId !== header.sessionId) continue;

    events.push(parsed);
    if (isContextMessageEvent(parsed)) {
      messages.push(parsed.message);
    }
  }

  return { header, path, events, messages };
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

async function createSessionRecord(paths: RuntimePaths, details?: unknown): Promise<SessionRecord> {
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

  const record: SessionRecord = { header, path, events: [], messages: [] };
  await appendSessionEvent(record, {
    type: "system",
    sessionId,
    timestamp: createdAt,
    name: "session_created",
    details,
  });

  return record;
}

export async function ensureCurrentSession(paths: RuntimePaths): Promise<SessionRecord> {
  const mostRecentPath = (await getSessionFiles(paths))[0];
  if (!mostRecentPath) {
    return createSessionRecord(paths, { reason: "first_use" });
  }

  const record = await parseSessionFile(mostRecentPath);
  if (!record) {
    return createSessionRecord(paths, { reason: "recovery_after_invalid_session" });
  }

  return record;
}

export async function createNewSession(paths: RuntimePaths): Promise<SessionRecord> {
  return createSessionRecord(paths, { reason: "new_session" });
}

export async function listSessions(paths: RuntimePaths): Promise<SessionSummary[]> {
  const sessionFiles = await getSessionFiles(paths);
  const records = await Promise.all(sessionFiles.map((path) => parseSessionFile(path)));

  return Promise.all(
    records.filter((record): record is SessionRecord => record !== undefined).map(async (record) => {
      const stats = await stat(record.path);
      const preview =
        record.events.find((event) => event.type === "user_message")?.message.content ?? "(no user messages)";

      return {
        sessionId: record.header.sessionId,
        path: record.path,
        createdAt: record.header.createdAt,
        updatedAt: stats.mtime.toISOString(),
        messageCount: record.messages.length,
        preview: typeof preview === "string" ? preview : JSON.stringify(preview),
      };
    })
  );
}

export async function getSessionById(paths: RuntimePaths, sessionId: string): Promise<SessionRecord | undefined> {
  for (const path of await getSessionFiles(paths)) {
    const record = await parseSessionFile(path);
    if (record?.header.sessionId === sessionId) return record;
  }

  return undefined;
}

export async function appendSessionEvent(record: SessionRecord, event: SessionEvent): Promise<void> {
  await writeFile(record.path, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
  record.events.push(event);
  if (isContextMessageEvent(event)) {
    record.messages.push(event.message);
  }
}

export async function appendUserMessageEvent(
  record: SessionRecord,
  prompt: string,
): Promise<UserMessageEvent> {
  const message: UserMessage = {
    role: "user",
    content: prompt,
    timestamp: Date.now(),
  };
  const event: UserMessageEvent = {
    type: "user_message",
    sessionId: record.header.sessionId,
    timestamp: new Date().toISOString(),
    message,
  };

  await appendSessionEvent(record, event);
  return event;
}

export async function appendAssistantMessageEvent(
  record: SessionRecord,
  message: AssistantMessage,
): Promise<AssistantMessageEvent> {
  const event: AssistantMessageEvent = {
    type: "assistant_message",
    sessionId: record.header.sessionId,
    timestamp: new Date().toISOString(),
    message,
    visibleText: getVisibleText(message),
    thinking: getThinkingBlocks(message),
  };

  await appendSessionEvent(record, event);
  return event;
}

export async function appendErrorEvent(record: SessionRecord, message: string, details?: unknown): Promise<ErrorEvent> {
  const event: ErrorEvent = {
    type: "error",
    sessionId: record.header.sessionId,
    timestamp: new Date().toISOString(),
    message,
    details,
  };

  await appendSessionEvent(record, event);
  return event;
}
