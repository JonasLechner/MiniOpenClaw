import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimePaths } from "../src/core/config.js";
import {
  appendAssistantMessageEvent,
  appendSessionCompactionEvent,
  appendToolResultMessageEvent,
  appendUserMessageEvent,
  ensureCurrentSession,
  getSessionMessages,
} from "../src/core/sessions.js";

const completeSimpleMock = vi.fn(async () => ({
  content: [{ type: "text", text: "goal: continue" }],
}));

vi.mock("@earendil-works/pi-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-ai")>();
  return {
    ...actual,
    completeSimple: completeSimpleMock,
  };
});

function createRuntimePaths(): RuntimePaths {
  const root = mkdtempSync(join(tmpdir(), "miniopenclaw-compaction-test-"));
  return {
    home: root,
    configFile: join(root, "config.json"),
    authFile: join(root, "auth.json"),
    sessions: join(root, "sessions"),
    workspace: join(root, "workspace"),
    memory: join(root, "workspace", "memory"),
    conversationBindings: join(root, "conversation-bindings.json"),
    scheduledTasks: join(root, "scheduled-tasks.json"),
    onboardingState: join(root, "onboarding.json"),
  };
}

function createAssistantToolCallMessage(): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "README.md" } }],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-test",
    usage: {
      input: 100,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 120,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  vi.clearAllMocks();
  completeSimpleMock.mockResolvedValue({ content: [{ type: "text", text: "goal: continue" }] });
});

describe("compaction", () => {
  it("does not compact when the estimate is below budget", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const session = await ensureCurrentSession(paths);
    await appendUserMessageEvent(session, "short prompt");

    const { maybeCompactSession } = await import("../src/core/compaction.js");
    const result = await maybeCompactSession({
      session,
      model: { contextWindow: 1000 },
      apiKey: "test",
      trigger: "automatic",
      reserveTokens: 100,
      keepRecentTokens: 100,
    });

    expect(result).toMatchObject({ compacted: false });
    expect(completeSimpleMock).not.toHaveBeenCalled();
  });

  it("treats forced manual compaction within budget as a no-op instead of an over-budget warning", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const session = await ensureCurrentSession(paths);
    await appendUserMessageEvent(session, "short prompt");

    const { maybeCompactSession } = await import("../src/core/compaction.js");
    const result = await maybeCompactSession({
      session,
      model: { contextWindow: 1000 },
      apiKey: "test",
      trigger: "manual",
      reserveTokens: 100,
      keepRecentTokens: 100,
      force: true,
    });

    expect(result).toMatchObject({ compacted: false, estimatedTokensBefore: expect.any(Number) });
    expect(result).not.toHaveProperty("warning");
    expect(completeSimpleMock).not.toHaveBeenCalled();
  });

  it("never chooses a boundary that keeps a tool result without its assistant tool call", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const session = await ensureCurrentSession(paths);
    await appendUserMessageEvent(session, "first");
    await appendAssistantMessageEvent(session, createAssistantToolCallMessage());
    await appendToolResultMessageEvent(session, {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "read",
      content: [{ type: "text", text: "very long tool output ".repeat(200) }],
      isError: false,
      timestamp: Date.now(),
    });
    await appendUserMessageEvent(session, "latest");

    const { chooseCompactionBoundary } = await import("../src/core/compaction.js");
    const boundary = chooseCompactionBoundary(session, 50);

    expect(boundary).toBeDefined();
    expect(boundary?.firstKeptEventIndex).toBeGreaterThanOrEqual(2);
    expect(boundary?.firstKeptMessage?.role).not.toBe("assistant");
  });

  it("compacts oversized assistant tool-call groups as a whole instead of keeping orphaned tool results", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const session = await ensureCurrentSession(paths);
    await appendUserMessageEvent(session, "fetch pages");
    await appendAssistantMessageEvent(session, createAssistantToolCallMessage());
    await appendToolResultMessageEvent(session, {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "read",
      content: [{ type: "text", text: "huge output ".repeat(5_000) }],
      isError: false,
      timestamp: Date.now(),
    });
    await appendAssistantMessageEvent(session, {
      role: "assistant",
      content: [{ type: "text", text: "done" }],
      api: "openai-responses",
      provider: "openai",
      model: "gpt-test",
      usage: {
        input: 100,
        output: 20,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 120,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });

    const { chooseCompactionBoundary } = await import("../src/core/compaction.js");
    const boundary = chooseCompactionBoundary(session, 100);

    expect(boundary).toBeDefined();
    expect(boundary?.firstKeptEventIndex).toBe(session.events.length - 1);
    expect(boundary?.firstKeptMessage).toBeUndefined();
    expect(boundary?.replacedMessages.some((message) => message.role === "toolResult")).toBe(true);
  });

  it("supports split-turn compaction for a very large user message", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const session = await ensureCurrentSession(paths);
    await appendUserMessageEvent(session, "x".repeat(10_000));
    await appendUserMessageEvent(session, "tail");

    const { chooseCompactionBoundary } = await import("../src/core/compaction.js");
    const boundary = chooseCompactionBoundary(session, 100);

    expect(boundary).toBeDefined();
    expect(boundary?.firstKeptEventIndex).toBe(2);
    expect(boundary?.firstKeptMessage).toMatchObject({ role: "user" });
  });

  it("does not compact the current oversized user prompt before the first answer", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const session = await ensureCurrentSession(paths);
    await appendUserMessageEvent(session, "earlier");
    await appendUserMessageEvent(session, "x".repeat(10_000));

    const { chooseCompactionBoundary } = await import("../src/core/compaction.js");
    const boundary = chooseCompactionBoundary(session, 100, session.events.length - 1);

    expect(boundary).toBeDefined();
    expect(boundary?.firstKeptEventIndex).toBe(session.events.length - 1);
    expect(boundary?.firstKeptMessage).toBeUndefined();
  });

  it("only treats a protected event as sticky when it is the current user prompt", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const session = await ensureCurrentSession(paths);
    await appendUserMessageEvent(session, "earlier");
    await appendAssistantMessageEvent(session, {
      role: "assistant",
      content: [{ type: "text", text: "x".repeat(10_000) }],
      api: "openai-responses",
      provider: "openai",
      model: "gpt-test",
      usage: {
        input: 100,
        output: 20,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 120,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    await appendUserMessageEvent(session, "tail");

    const { chooseCompactionBoundary } = await import("../src/core/compaction.js");
    const assistantEventIndex = session.events.findIndex((event) => event.type === "assistant_message");
    const baselineBoundary = chooseCompactionBoundary(session, 100);
    const protectedBoundary = chooseCompactionBoundary(session, 100, assistantEventIndex);

    expect(protectedBoundary).toBeDefined();
    expect(protectedBoundary).toEqual(baselineBoundary);
  });

  it("preserves split kept message content across repeated compactions", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const session = await ensureCurrentSession(paths);
    await appendUserMessageEvent(session, "x".repeat(10_000));
    await appendUserMessageEvent(session, "tail");

    const { chooseCompactionBoundary } = await import("../src/core/compaction.js");
    const firstBoundary = chooseCompactionBoundary(session, 100);
    expect(firstBoundary?.firstKeptMessage).toMatchObject({ role: "user" });

    await appendSessionCompactionEvent(session, {
      summary: "goal: continue",
      firstKeptEventIndex: firstBoundary!.firstKeptEventIndex,
      firstKeptMessage: firstBoundary!.firstKeptMessage,
      estimatedTokensBefore: 10000,
      estimatedTokensAfter: 100,
      trigger: "automatic",
    });

    const messages = getSessionMessages(session);
    expect(messages[1]).toEqual(firstBoundary!.firstKeptMessage);

    const secondBoundary = chooseCompactionBoundary(session, 1);
    expect(secondBoundary).toBeDefined();
    expect(Number.isInteger(secondBoundary?.firstKeptEventIndex)).toBe(true);
    expect(secondBoundary?.replacedMessages.some((message) => message.role === "user" && String(message.content).includes(String(firstBoundary!.firstKeptMessage?.content).slice(0, 16)))).toBe(true);
  });

  it("reconstructs compacted context without re-including events when an older compaction stored a fractional boundary", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const session = await ensureCurrentSession(paths);
    await appendUserMessageEvent(session, "prefix");
    const tailEvent = await appendUserMessageEvent(session, "tail");
    const tailEventIndex = session.events.length - 1;

    await appendSessionCompactionEvent(session, {
      summary: "goal: continue",
      firstKeptEventIndex: tailEventIndex + 0.5,
      firstKeptMessage: { ...tailEvent.message, content: "il" },
      estimatedTokensBefore: 10000,
      estimatedTokensAfter: 100,
      trigger: "automatic",
    });

    const messages = getSessionMessages(session);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ role: "user", content: "il" });
  });

  it("appends a compaction event when the estimate crosses the threshold", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const session = await ensureCurrentSession(paths);
    await appendUserMessageEvent(session, "x".repeat(10_000));
    await appendUserMessageEvent(session, "follow-up");

    const { maybeCompactSession } = await import("../src/core/compaction.js");
    const result = await maybeCompactSession({
      session,
      model: { contextWindow: 1000 },
      apiKey: "test",
      trigger: "automatic",
      reserveTokens: 100,
      keepRecentTokens: 100,
    });

    expect(result.compacted).toBe(true);
    expect(completeSimpleMock).toHaveBeenCalledTimes(1);
    expect(session.events.at(-1)).toMatchObject({ type: "session_compaction", trigger: "automatic" });
  });

  it("fails fast when compaction summarization fails", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const session = await ensureCurrentSession(paths);
    await appendUserMessageEvent(session, "x".repeat(10_000));
    await appendUserMessageEvent(session, "follow-up");
    completeSimpleMock.mockRejectedValueOnce(new Error("summary auth failed"));

    const { maybeCompactSession } = await import("../src/core/compaction.js");
    await expect(maybeCompactSession({
      session,
      model: { contextWindow: 1000 },
      apiKey: "test",
      trigger: "automatic",
      reserveTokens: 100,
      keepRecentTokens: 100,
    })).rejects.toThrow("summary auth failed");
    expect(session.events.at(-1)?.type).not.toBe("session_compaction");
  });

  it("estimates compacted sessions from reconstructed context instead of stale assistant usage totals", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const session = await ensureCurrentSession(paths);
    await appendUserMessageEvent(session, "first");
    await appendAssistantMessageEvent(session, {
      role: "assistant",
      content: [{ type: "text", text: "large prior reply" }],
      api: "openai-responses",
      provider: "openai",
      model: "gpt-test",
      usage: {
        input: 50_000,
        output: 50_000,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 100_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    await appendUserMessageEvent(session, "latest");
    await appendSessionCompactionEvent(session, {
      summary: "goal: continue",
      firstKeptEventIndex: session.events.length,
      estimatedTokensBefore: 100_000,
      estimatedTokensAfter: 100,
      trigger: "manual",
    });

    const { estimateSessionContextTokens, estimateMessageTokens, getSyntheticSummaryMessage } = await import("../src/core/compaction.js");
    expect(estimateSessionContextTokens(session)).toBe(estimateMessageTokens(getSyntheticSummaryMessage("goal: continue")));
  });
});
