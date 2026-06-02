import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function waitFor(condition: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error("Timeout waiting for condition");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}
import type { RuntimePaths } from "../src/lib/config.js";
import type { RuntimeState } from "../src/lib/runtime.js";
import { getSessionById, getSessionMessages, listSessions } from "../src/lib/sessions.js";

const streamSimpleMock = vi.fn();
const completeMock = vi.fn();
const validateToolCallMock = vi.fn();
const runtimeStateMock = vi.fn<() => RuntimeState>();
const resolveAgentAuthMock = vi.fn();
const sandboxEnsureMock = vi.fn(async () => {});
const sandboxExecMock = vi.fn(async () => ({ output: "" }));
const sandboxDisposeMock = vi.fn(async () => {});
const sandboxFactoryCreateMock = vi.fn(() => ({
  ensure: sandboxEnsureMock,
  exec: sandboxExecMock,
  dispose: sandboxDisposeMock,
}));
const createSandboxFactoryMock = vi.fn(async () => ({
  create: sandboxFactoryCreateMock,
}));
const resolveSandboxEngineKindMock = vi.fn(async () => "podman");

vi.mock("@earendil-works/pi-ai", () => ({
  streamSimple: streamSimpleMock,
  complete: completeMock,
  validateToolCall: validateToolCallMock,
  Type: {
    Object: (value: unknown) => value,
    String: () => ({ type: "string" }),
    Number: () => ({ type: "number" }),
    Boolean: () => ({ type: "boolean" }),
    Optional: (value: unknown) => value,
    Union: (value: unknown) => value,
    Literal: (value: unknown) => value,
  },
}));

vi.mock("../src/lib/runtime.js", () => ({
  initializeRuntime: runtimeStateMock,
}));

vi.mock("../src/agent/auth.js", () => ({
  resolveAgentAuth: resolveAgentAuthMock,
}));

vi.mock("../src/lib/sandbox/factory.js", () => ({
  createSandboxFactory: createSandboxFactoryMock,
  resolveSandboxEngineKind: resolveSandboxEngineKindMock,
}));

function createRuntimePaths(): RuntimePaths {
  const root = mkdtempSync(join(tmpdir(), "miniopenclaw-loop-test-"));
  return {
    home: root,
    configFile: join(root, "config.json"),
    authFile: join(root, "auth.json"),
    sessions: join(root, "sessions"),
    workspace: join(root, "workspace"),
    memory: join(root, "workspace", "memory"),
  };
}

function createFakeEventStream() {
  const response = {
    role: "assistant" as const,
    content: [
      { type: "thinking" as const, thinking: "hidden chain" },
      { type: "text" as const, text: "Hello world" },
    ],
    api: "openai-responses" as const,
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
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };

  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "text_start" as const, contentIndex: 1, partial: response };
      yield { type: "text_delta" as const, contentIndex: 1, delta: "Hello ", partial: response };
      yield { type: "text_delta" as const, contentIndex: 1, delta: "world", partial: response };
      yield { type: "done" as const, reason: "stop" as const, message: response };
    },
    async result() {
      return response;
    },
  };
}

let paths: RuntimePaths;

afterEach(() => {
  rmSync(paths.home, { recursive: true, force: true });
  vi.clearAllMocks();
});

function createAssistantTextResponse(text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-responses" as const,
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
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };
}

function createToolUseEventStream(toolCall: { id: string; name: string; arguments: Record<string, unknown> }) {
  const response = {
    role: "assistant" as const,
    content: [{ type: "toolCall" as const, id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments }],
    api: "openai-responses" as const,
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
    stopReason: "toolUse" as const,
    timestamp: Date.now(),
  };

  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "done" as const, reason: "toolUse" as const, message: response };
    },
    async result() {
      return response;
    },
  };
}

beforeEach(() => {
  paths = createRuntimePaths();
  runtimeStateMock.mockReturnValue({
    config: {
      gateway: { host: "127.0.0.1", port: 3000 },
      agent: { provider: "openai", modelId: "gpt-test", reasoning: undefined },
      sandbox: {
        enabled: true,
        engine: "auto",
        image: "miniopenclaw-sandbox:local",
        network: "none",
        memoryMb: undefined,
        cpus: undefined,
        pidsLimit: undefined,
      },
    },
    paths,
  });
  resolveAgentAuthMock.mockResolvedValue({
    provider: "openai",
    modelId: "gpt-test",
    model: { provider: "openai", id: "gpt-test" },
    apiKey: "test-key",
  });
  streamSimpleMock.mockImplementation(() => createFakeEventStream());
  completeMock.mockResolvedValue(
    createAssistantTextResponse(
      '{"summary":"User prefers concise answers and cares about lint-related workflow.","keywords":["memory","lint","preference"]}',
    ),
  );
  sandboxEnsureMock.mockClear();
  sandboxExecMock.mockClear();
  sandboxDisposeMock.mockClear();
  sandboxExecMock.mockResolvedValue({ output: "" });
  createSandboxFactoryMock.mockClear();
  sandboxFactoryCreateMock.mockClear();
  resolveSandboxEngineKindMock.mockClear();
  validateToolCallMock.mockImplementation((_tools, call) => call.arguments);
});

describe("Agent", () => {
  it("streams normalized deltas to the callback and persists the final assistant message", async () => {
    const { Agent } = await import("../src/agent/agent.js");
    const agent = await Agent.create();
    const seenDeltas: string[] = [];

    const result = await agent.runLoop("hello", {
      onEvent(event) {
        if (event.type === "message_delta") {
          seenDeltas.push(event.delta);
        }
      },
    });

    expect(seenDeltas).toEqual(["Hello ", "world"]);
    expect(result).toMatchObject({
      text: "Hello world",
      stopReason: "stop",
    });

    const [sessionSummary] = await listSessions(paths);
    expect(sessionSummary).toBeDefined();

    const session = await getSessionById(paths, sessionSummary!.sessionId);
    const assistantEvent = session?.events.find((event) => event.type === "assistant_message");
    expect(assistantEvent).toMatchObject({
      type: "assistant_message",
      visibleText: "Hello world",
      thinking: ["hidden chain"],
    });

    // persistSessionSummary is disabled; memory file assertions skipped
    // const memorySummary = await readFile(
    //   join(paths.memory, "session-summaries", `session-${sessionSummary!.sessionId}-summary.md`),
    //   "utf8",
    // );
    // expect(memorySummary).toContain("Total turns: 1");
    // expect(memorySummary).toContain("- User: hello");
    // expect(memorySummary).toContain("- Assistant: Hello world");
  });

  it("creates a new session that becomes the current session", async () => {
    const { Agent } = await import("../src/agent/agent.js");
    const agent = await Agent.create();

    await agent.runLoop("first prompt");
    const firstSessionId = (await listSessions(paths))[0]?.sessionId;

    const fresh = await agent.newSession();
    await agent.runLoop("second prompt");
    const sessions = await listSessions(paths);
    expect(sessions).toHaveLength(2);
    expect(fresh.sessionId).not.toBe(firstSessionId);
    expect(sessions[0]?.sessionId).toBe(fresh.sessionId);
    expect(sessions[1]?.sessionId).toBe(firstSessionId);
  });

  it("resolves sandbox engine once during startup and builds the factory from it", async () => {
    const { Agent } = await import("../src/agent/agent.js");

    await Agent.create();

    expect(resolveSandboxEngineKindMock).toHaveBeenCalledTimes(1);
    expect(resolveSandboxEngineKindMock).toHaveBeenCalledWith({
      enabled: true,
      engine: "auto",
      image: "miniopenclaw-sandbox:local",
      network: "none",
      memoryMb: undefined,
      cpus: undefined,
      pidsLimit: undefined,
    });
    expect(createSandboxFactoryMock).toHaveBeenCalledTimes(1);
    expect(createSandboxFactoryMock).toHaveBeenCalledWith({
      enabled: true,
      engine: "auto",
      image: "miniopenclaw-sandbox:local",
      network: "none",
      memoryMb: undefined,
      cpus: undefined,
      pidsLimit: undefined,
    }, "podman");
  });
  it("disposes the session sandbox when starting a new session", async () => {
    const { Agent } = await import("../src/agent/agent.js");
    const agent = await Agent.create();

    await agent.runLoop("first prompt");
    await agent.newSession();

    expect(sandboxDisposeMock).toHaveBeenCalledTimes(1);
    expect(sandboxDisposeMock).toHaveBeenCalledWith("remove");
  });

  it("disposes the persisted session sandbox on newSession even before the sandbox is loaded in memory", async () => {
    const { Agent } = await import("../src/agent/agent.js");
    const agent = await Agent.create();

    await agent.newSession();

    expect(sandboxFactoryCreateMock).toHaveBeenCalledTimes(1);
    expect(sandboxDisposeMock).toHaveBeenCalledTimes(1);
    expect(sandboxDisposeMock).toHaveBeenCalledWith("remove");
  });

  it("persists an error event and rethrows provider failures", async () => {
    const { Agent } = await import("../src/agent/agent.js");
    const agent = await Agent.create();

    streamSimpleMock.mockImplementationOnce(() => {
      throw new Error("provider offline");
    });

    await expect(agent.runLoop("hello")).rejects.toThrow("provider offline");
    const [sessionSummary] = await listSessions(paths);
    const session = await getSessionById(paths, sessionSummary!.sessionId);
    const errorEvent = session?.events.find((event) => event.type === "error");
    expect(errorEvent).toMatchObject({
      type: "error",
      message: "provider offline",
    });
  });

  it.skip("stores llm-generated keywords in the session summary", async () => {
    const { Agent } = await import("../src/agent/agent.js");
    const agent = await Agent.create();

    completeMock.mockResolvedValueOnce(
      createAssistantTextResponse(
        '{"summary":"User prefers lint-conscious concise responses.","keywords":["lint","preference","style"]}',
      ),
    );

    await agent.runLoop("remember my lint preference");

    const [sessionSummary] = await listSessions(paths);
    const memorySummary = await readFile(
      join(paths.memory, "session-summaries", `session-${sessionSummary!.sessionId}-summary.md`),
      "utf8",
    );
    expect(memorySummary).toContain("summary: User prefers lint-conscious concise responses.");
    expect(memorySummary).toContain("keywords: [lint, preference, style]");
  });

  it.skip("generates session keywords from the full session summary body", async () => {
    const { Agent } = await import("../src/agent/agent.js");
    const agent = await Agent.create();

    await agent.runLoop("my name is jonas");
    await agent.runLoop("i like soccer");

    // Wait for both background persistSessionSummary calls to finish
    await waitFor(() => completeMock.mock.calls.length >= 2);

    const keywordCall = [...completeMock.mock.calls]
      .reverse()
      .find((call) => String((call[1] as { systemPrompt?: string })?.systemPrompt).includes("Generate memory metadata for retrieval"));
    expect(keywordCall).toBeDefined();
    const context = keywordCall?.[1] as { messages: Array<{ content: Array<{ text: string }> }> };
    const text = context.messages[0]?.content[0]?.text ?? "";
    expect(text).toContain("my name is jonas");
    expect(text).toContain("i like soccer");
    expect(text).toContain("## Turn 1");
    expect(text).toContain("## Turn 2");
  });

  /*
  it("injects retrieved memory into the system prompt", async () => {
    const { Agent } = await import("../src/agent/agent.js");
    const agent = await Agent.create();

    await agent.runLoop("remember my lint preference");
    await agent.runLoop("what do you remember about my lint preference?");

    const secondCall = streamSimpleMock.mock.calls[1];
    expect(secondCall).toBeDefined();
    const llmContext = secondCall?.[1] as { systemPrompt?: string };
    expect(llmContext.systemPrompt).toContain("Relevant memory retrieved for this turn:");
    expect(llmContext.systemPrompt).toContain("remember my lint preference");
  });
  */

  it("persists intermediate assistant tool calls and tool results with matching toolCallIds", async () => {
    const { Agent } = await import("../src/agent/agent.js");
    const agent = await Agent.create();

    streamSimpleMock
      .mockImplementationOnce(() => createToolUseEventStream({ id: "call_123", name: "bash", arguments: { command: "pwd" } }))
      .mockImplementationOnce(() => createFakeEventStream());
    sandboxExecMock.mockResolvedValueOnce({ output: "/workspace\n" });

    await agent.runLoop("run pwd");

    const [sessionSummary] = await listSessions(paths);
    const session = await getSessionById(paths, sessionSummary!.sessionId);
    const assistantMessages = session?.events.filter((event) => event.type === "assistant_message") ?? [];
    const toolResultEvent = session?.events.find((event) => event.type === "tool_result_message");

    expect(assistantMessages).toHaveLength(2);
    expect(assistantMessages[0]).toMatchObject({
      type: "assistant_message",
      message: {
        stopReason: "toolUse",
        content: [{ type: "toolCall", id: "call_123", name: "bash", arguments: { command: "pwd" } }],
      },
    });
    expect(toolResultEvent).toMatchObject({
      type: "tool_result_message",
      message: {
        role: "toolResult",
        toolCallId: "call_123",
        toolName: "bash",
        isError: false,
      },
    });
    expect(session ? getSessionMessages(session) : undefined).toEqual([
      expect.objectContaining({ role: "user", content: "run pwd" }),
      expect.objectContaining({ role: "assistant", stopReason: "toolUse" }),
      expect.objectContaining({ role: "toolResult", toolCallId: "call_123", toolName: "bash" }),
      expect.objectContaining({ role: "assistant", stopReason: "stop" }),
    ]);
  });

  it("persists tool loop messages before rethrowing a post-tool provider failure", async () => {
    const { Agent } = await import("../src/agent/agent.js");
    const agent = await Agent.create();

    streamSimpleMock
      .mockImplementationOnce(() => createToolUseEventStream({ id: "call_123", name: "bash", arguments: { command: "pwd" } }))
      .mockImplementationOnce(() => {
        throw new Error("provider offline");
      });
    sandboxExecMock.mockResolvedValueOnce({ output: "/workspace\n" });

    await expect(agent.runLoop("run pwd")).rejects.toThrow("provider offline");

    const [sessionSummary] = await listSessions(paths);
    const session = await getSessionById(paths, sessionSummary!.sessionId);

    expect(session?.events.map((event) => event.type)).toEqual([
      "system",
      "user_message",
      "assistant_message",
      "tool_result_message",
      "error",
    ]);
    expect(session ? getSessionMessages(session) : undefined).toEqual([
      expect.objectContaining({ role: "user", content: "run pwd" }),
      expect.objectContaining({ role: "assistant", stopReason: "toolUse" }),
      expect.objectContaining({ role: "toolResult", toolCallId: "call_123", toolName: "bash" }),
    ]);
  });

  it("exposes an Agent wrapper with persistent listeners", async () => {
    const { Agent } = await import("../src/agent/agent.js");
    const agent = await Agent.create();
    const seenTypes: string[] = [];

    agent.onEvent((event) => {
      seenTypes.push(event.type);
    });

    await agent.runLoop("hello");
    expect(seenTypes).toEqual([
      "agent_start",
      "turn_start",
      "message_start",
      "message_delta",
      "message_delta",
      "message_end",
      "turn_end",
      "agent_end",
    ]);
  });
});
