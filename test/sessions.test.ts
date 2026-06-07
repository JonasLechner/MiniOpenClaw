import { mkdtempSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentContext } from "../src/core/agent-context.js";
import type { RuntimePaths } from "../src/core/config.js";
import {
  appendAssistantMessageEvent,
  appendErrorEvent,
  appendSessionCompactionEvent,
  appendToolResultMessageEvent,
  appendUserMessageEvent,
  ensureCurrentSession,
  getSessionById,
  getSessionMessages,
  listSessions,
  SESSION_FORMAT_VERSION,
} from "../src/core/sessions.js";

function createRuntimePaths(): RuntimePaths {
  const root = mkdtempSync(join(tmpdir(), "miniopenclaw-test-"));
  return {
    home: root,
    configFile: join(root, "config.json"),
    authFile: join(root, "auth.json"),
    sessions: join(root, "sessions"),
    workspace: join(root, "workspace"),
    memory: join(root, "workspace", "memory"),
    conversationBindings: join(root, "conversation-bindings.json"),
    scheduledTasks: join(root, "scheduled-tasks.json"),
  };
}

function createAssistantMessage(): AssistantMessage {
  return {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "first thought" },
      { type: "text", text: "hello" },
      { type: "thinking", thinking: "second thought" },
      { type: "text", text: "world" },
    ],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function createToolResultMessage(): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "call_123",
    toolName: "bash",
    content: [{ type: "text", text: '{"output":"/workspace"}' }],
    isError: false,
    timestamp: Date.now(),
  };
}

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("sessions", () => {
  it("creates a first-use session as append-only JSONL", async () => {
    const paths = createRuntimePaths();
    tempRoots.push(paths.home);

    const session = await ensureCurrentSession(paths);
    const lines = readFileSync(session.path, "utf8").trim().split("\n");
    const currentSessions = JSON.parse(readFileSync(join(paths.home, "current-sessions.json"), "utf8")) as Record<string, string>;

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({
      type: "session",
      version: SESSION_FORMAT_VERSION,
      sessionId: session.sessionId,
    });
    expect(JSON.parse(lines[1])).toMatchObject({
      type: "system",
      sessionId: session.sessionId,
      name: "session_created",
      details: { reason: "first_use", surface: "tui" },
    });
    expect(currentSessions.tui).toBe(session.sessionId);
  });

  it("records user, assistant, tool result, and error events and keeps context messages ready", async () => {
    const paths = createRuntimePaths();
    tempRoots.push(paths.home);
    const session = await ensureCurrentSession(paths);

    await appendUserMessageEvent(session, "hello");
    await appendAssistantMessageEvent(session, createAssistantMessage());
    await appendToolResultMessageEvent(session, createToolResultMessage());
    await appendErrorEvent(session, "boom", { code: "E_TEST" });

    const persisted = await getSessionById(paths, session.sessionId);
    expect(persisted).toBeDefined();
    expect(persisted?.events.map((event) => event.type)).toEqual([
      "system",
      "user_message",
      "assistant_message",
      "tool_result_message",
      "error",
    ]);

    const assistantEvent = persisted?.events.find((event) => event.type === "assistant_message");
    expect(assistantEvent).toMatchObject({
      type: "assistant_message",
      visibleText: "hello\nworld",
      thinking: ["first thought", "second thought"],
    });

    const context = createAgentContext(getSessionMessages(persisted!), "test");
    expect(context.systemPrompt).toBe("test");
    expect(context.messages).toHaveLength(3);
    expect(context.messages[0]).toMatchObject({ role: "user" });
    expect(context.messages[0]?.content).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] hello$/);
    expect(context.messages[1]).toMatchObject({ role: "assistant", stopReason: "stop" });
    expect(context.messages[2]).toMatchObject({ role: "toolResult", toolCallId: "call_123", toolName: "bash" });
  });

  it("reconstructs context from the latest compaction boundary", async () => {
    const paths = createRuntimePaths();
    tempRoots.push(paths.home);
    const session = await ensureCurrentSession(paths);

    await appendUserMessageEvent(session, "first");
    const assistant = createAssistantMessage();
    assistant.content = [{ type: "text", text: "intermediate" }];
    await appendAssistantMessageEvent(session, assistant);
    await appendUserMessageEvent(session, "latest");
    await appendSessionCompactionEvent(session, {
      summary: "goal: keep working",
      firstKeptEventIndex: 3,
      estimatedTokensBefore: 50000,
      estimatedTokensAfter: 8000,
      trigger: "automatic",
    });

    const messages = getSessionMessages(session);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "assistant", provider: "miniopenclaw", model: "session-compaction" });
    expect(messages[1]).toMatchObject({ role: "user" });
    expect(messages[1]?.content).toMatch(/latest$/);
  });

  it("lets the latest compaction event win", async () => {
    const paths = createRuntimePaths();
    tempRoots.push(paths.home);
    const session = await ensureCurrentSession(paths);

    await appendUserMessageEvent(session, "first");
    await appendUserMessageEvent(session, "second");
    await appendUserMessageEvent(session, "third");
    await appendSessionCompactionEvent(session, {
      summary: "older summary",
      firstKeptEventIndex: 1,
      estimatedTokensBefore: 40000,
      estimatedTokensAfter: 12000,
      trigger: "automatic",
    });
    await appendSessionCompactionEvent(session, {
      summary: "newer summary",
      firstKeptEventIndex: 3,
      estimatedTokensBefore: 30000,
      estimatedTokensAfter: 9000,
      trigger: "automatic",
    });

    const messages = getSessionMessages(session);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "assistant" });
    expect(messages[0]?.content).toMatchObject([{ type: "text", text: expect.stringContaining("newer summary") }]);
    expect(messages[1]?.content).toMatch(/third$/);
  });

  it("tracks current sessions separately for tui and gateway while still listing sessions by update time", async () => {
    const paths = createRuntimePaths();
    tempRoots.push(paths.home);

    const tuiSession = await ensureCurrentSession(paths, "tui");
    await appendUserMessageEvent(tuiSession, "older");

    const gatewaySession = await ensureCurrentSession(paths, "gateway");
    await appendUserMessageEvent(gatewaySession, "newer");

    const olderTime = new Date("2024-01-01T00:00:00.000Z");
    const newerTime = new Date("2024-01-01T00:00:01.000Z");
    utimesSync(tuiSession.path, olderTime, olderTime);
    utimesSync(gatewaySession.path, newerTime, newerTime);

    expect((await ensureCurrentSession(paths, "tui")).sessionId).toBe(tuiSession.sessionId);
    expect((await ensureCurrentSession(paths, "gateway")).sessionId).toBe(gatewaySession.sessionId);

    const sessions = await listSessions(paths);
    expect(sessions.map((session) => session.sessionId)).toEqual([
      gatewaySession.sessionId,
      tuiSession.sessionId,
    ]);
    expect(sessions[0]?.preview).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] newer$/);
  });
});
