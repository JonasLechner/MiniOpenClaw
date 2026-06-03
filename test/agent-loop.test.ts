import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimePaths } from "../src/core/config.js";
import type { RuntimeState } from "../src/core/runtime.js";
import { getSessionById, getSessionMessages, listSessions } from "../src/core/sessions.js";
import {
  expectSessionEventTypes,
  expectToolResultsToMatchAssistantCalls,
  getToolResultMessages,
  getToolResultText,
  loadOnlySession,
} from "./helpers/session-assertions.js";

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

vi.mock("../src/core/runtime.js", () => ({
  initializeRuntime: runtimeStateMock,
}));

vi.mock("../src/agent/auth.js", () => ({
  resolveAgentAuth: resolveAgentAuthMock,
}));

vi.mock("../src/sandbox/factory.js", () => ({
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
    conversationBindings: join(root, "conversation-bindings.json"),
    scheduledTasks: join(root, "scheduled-tasks.json"),
  };
}

function createFakeEventStreamWithText(text: string) {
  const response = {
    role: "assistant" as const,
    content: [
      { type: "thinking" as const, thinking: "hidden chain" },
      { type: "text" as const, text },
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
      yield { type: "text_delta" as const, contentIndex: 1, delta: text, partial: response };
      yield { type: "done" as const, reason: "stop" as const, message: response };
    },
    async result() {
      return response;
    },
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

function createAbortDuringStreamingEventStream(response = createAssistantTextResponse("partial final should not persist")) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "text_start" as const, contentIndex: 0, partial: response };
      yield { type: "text_delta" as const, contentIndex: 0, delta: "partial", partial: response };
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    },
    async result() {
      throw new Error("result should not be read after an aborted stream");
    },
  };
}

function createToolUseEventStream(toolCall: { id: string; name: string; arguments: Record<string, unknown> }) {
  return createMultiToolUseEventStream([toolCall]);
}

function createMultiToolUseEventStream(toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>) {
  const response = {
    role: "assistant" as const,
    content: toolCalls.map((toolCall) => ({
      type: "toolCall" as const,
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
    })),
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

function createAssistantDoneEventStream(text: string) {
  const response = createAssistantTextResponse(text);

  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "done" as const, reason: "stop" as const, message: response };
    },
    async result() {
      return response;
    },
  };
}

beforeEach(() => {
  paths = createRuntimePaths();
  mkdirSync(paths.workspace, { recursive: true });
  runtimeStateMock.mockReturnValue({
    config: {
      gateway: {
        host: "127.0.0.1",
        port: 3000,
        telegram: { enabled: false, token: undefined, polling: true, allowedUserIds: [] },
      },
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
      logging: { level: "info" },
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

  });

  it("asks before appending relevant durable user context", async () => {
    streamSimpleMock.mockImplementationOnce(() => createFakeEventStreamWithText("That sounds like useful ongoing context. Should I append this to workspace/context.md?\n\n> I prefer concise answers\n<context_candidate>I prefer concise answers</context_candidate>"));
    const { Agent } = await import("../src/agent/agent.js");
    const agent = await Agent.create();

    const result = await agent.runLoop("I prefer concise answers");

    expect(result.text).toContain("Should I append this to workspace/context.md?");
    expect(result.text).toContain("I prefer concise answers");
    expect(result.text).not.toContain("<context_candidate>");
    expect(streamSimpleMock).toHaveBeenCalledTimes(1);
  });

  it("appends approved user context to context.md", async () => {
    streamSimpleMock.mockImplementationOnce(() => createFakeEventStreamWithText("That sounds like useful ongoing context. Should I append this to workspace/context.md?\n\n> I am using Windows\n<context_candidate>I am using Windows</context_candidate>"));
    const { Agent } = await import("../src/agent/agent.js");
    const agent = await Agent.create();

    await agent.runLoop("I am using Windows");
    const result = await agent.runLoop("yes");

    expect(result.text).toContain("Appended to workspace/context.md.");
    expect(readFileSync(join(paths.workspace, "context.md"), "utf8")).toContain("I am using Windows");
    expect(streamSimpleMock).toHaveBeenCalledTimes(1);
  });

  it("appends context.md to every request", async () => {
    const { Agent } = await import("../src/agent/agent.js");
    const agent = await Agent.create();

    writeFileSync(join(paths.workspace, "context.md"), "first context", "utf8");
    await agent.runLoop("first prompt");

    writeFileSync(join(paths.workspace, "context.md"), "second context", "utf8");
    await agent.runLoop("second prompt");

    const firstContext = streamSimpleMock.mock.calls[0]?.[1] as { systemPrompt?: string };
    const secondContext = streamSimpleMock.mock.calls[1]?.[1] as { systemPrompt?: string };

    expect(firstContext.systemPrompt).toContain("<context>");
    expect(firstContext.systemPrompt).toContain("first context");
    expect(secondContext.systemPrompt).toContain("second context");
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

  it("re-resolves agent auth for each run so OAuth tokens can refresh when needed", async () => {
    const { Agent } = await import("../src/agent/agent.js");
    const agent = await Agent.create();

    await agent.runLoop("first prompt");
    await agent.runLoop("second prompt");

    expect(resolveAgentAuthMock).toHaveBeenCalledTimes(3);
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


  it("stops during streaming and persists only the user message plus aborted assistant message", async () => {
    const { Agent } = await import("../src/agent/agent.js");
    const agent = await Agent.create();
    const seenDeltas: string[] = [];
    const controller = new AbortController();

    streamSimpleMock.mockImplementationOnce(() => createAbortDuringStreamingEventStream());

    const result = await agent.runLoop("please stream", {
      signal: controller.signal,
      onEvent(event) {
        if (event.type === "message_delta") {
          seenDeltas.push(event.delta);
          controller.abort();
        }
      },
    });

    expect(seenDeltas).toEqual(["partial"]);
    expect(result).toMatchObject({ text: "Stopped.", stopReason: "aborted", errorMessage: "Aborted by user" });

    const [sessionSummary] = await listSessions(paths);
    const session = await getSessionById(paths, sessionSummary!.sessionId);
    expect(session?.events.map((event) => event.type)).toEqual(["system", "user_message", "assistant_message"]);
    expect(session ? getSessionMessages(session) : undefined).toEqual([
      expect.objectContaining({ role: "user", content: expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] please stream$/) }),
      expect.objectContaining({ role: "assistant", stopReason: "aborted", errorMessage: "Aborted by user" }),
    ]);
  });

  it("stops after a tool call without starting another model stream and persists the message array", async () => {
    const { Agent } = await import("../src/agent/agent.js");
    const agent = await Agent.create();

    const controller = new AbortController();
    streamSimpleMock.mockImplementationOnce(() => createToolUseEventStream({ id: "call_123", name: "bash", arguments: { command: "pwd" } }));
    sandboxExecMock.mockImplementationOnce(async () => {
      controller.abort();
      return { output: "/workspace\n" };
    });

    const result = await agent.runLoop("run pwd", { signal: controller.signal });

    expect(result).toMatchObject({ text: "Stopped.", stopReason: "aborted", errorMessage: "Aborted by user" });
    expect(streamSimpleMock).toHaveBeenCalledTimes(1);

    const [sessionSummary] = await listSessions(paths);
    const session = await getSessionById(paths, sessionSummary!.sessionId);
    expect(session ? getSessionMessages(session) : undefined).toEqual([
      expect.objectContaining({ role: "user", content: expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] run pwd$/) }),
      expect.objectContaining({ role: "assistant", stopReason: "toolUse" }),
      expect.objectContaining({ role: "toolResult", toolCallId: "call_123", toolName: "bash", isError: false }),
      expect.objectContaining({ role: "assistant", stopReason: "aborted", errorMessage: "Aborted by user" }),
    ]);
  });

  it("stops before later tool calls when aborted during the first tool execution", async () => {
    const { Agent } = await import("../src/agent/agent.js");
    const agent = await Agent.create();

    const controller = new AbortController();
    streamSimpleMock.mockImplementationOnce(() => createMultiToolUseEventStream([
      { id: "call_123", name: "bash", arguments: { command: "pwd" } },
      { id: "call_456", name: "bash", arguments: { command: "ls" } },
    ]));
    sandboxExecMock.mockImplementationOnce(async () => {
      controller.abort();
      return { output: "/workspace\n" };
    });

    const result = await agent.runLoop("run pwd and ls", { signal: controller.signal });

    expect(result).toMatchObject({ text: "Stopped.", stopReason: "aborted", errorMessage: "Aborted by user" });
    expect(streamSimpleMock).toHaveBeenCalledTimes(1);
    expect(sandboxExecMock).toHaveBeenCalledTimes(1);

    const [sessionSummary] = await listSessions(paths);
    const session = await getSessionById(paths, sessionSummary!.sessionId);
    expect(session ? getSessionMessages(session) : undefined).toEqual([
      expect.objectContaining({ role: "user", content: expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] run pwd and ls$/) }),
      expect.objectContaining({ role: "assistant", stopReason: "toolUse" }),
      expect.objectContaining({ role: "toolResult", toolCallId: "call_123", toolName: "bash", isError: false }),
      expect.objectContaining({ role: "assistant", stopReason: "aborted", errorMessage: "Aborted by user" }),
    ]);
    expect(session ? getSessionMessages(session)?.some((message) => message.role === "toolResult" && message.toolCallId === "call_456") : false).toBe(false);
  });

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
      expect.objectContaining({ role: "user", content: expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] run pwd$/) }),
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
      expect.objectContaining({ role: "user", content: expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] run pwd$/) }),
      expect.objectContaining({ role: "assistant", stopReason: "toolUse" }),
      expect.objectContaining({ role: "toolResult", toolCallId: "call_123", toolName: "bash" }),
    ]);
  });

  it("runs a real write workflow and persists filesystem plus session messages", async () => {
    const { Agent } = await import("../src/agent/agent.js");
    const agent = await Agent.create();

    streamSimpleMock
      .mockImplementationOnce(() => createToolUseEventStream({
        id: "call_write",
        name: "write",
        arguments: { path: "workflow.txt", content: "alpha\nbeta\n" },
      }))
      .mockImplementationOnce(() => createAssistantDoneEventStream("Wrote workflow.txt."));

    const result = await agent.runLoop("create workflow file");

    expect(result).toMatchObject({ text: "Wrote workflow.txt.", stopReason: "stop" });
    expect(await readFile(join(paths.workspace, "workflow.txt"), "utf8")).toBe("alpha\nbeta\n");

    const session = await loadOnlySession(paths);
    const messages = getSessionMessages(session);
    expect(messages).toEqual([
      expect.objectContaining({ role: "user", content: expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] create workflow file$/) }),
      expect.objectContaining({
        role: "assistant",
        stopReason: "toolUse",
        content: [{ type: "toolCall", id: "call_write", name: "write", arguments: { path: "workflow.txt", content: "alpha\nbeta\n" } }],
      }),
      expect.objectContaining({
        role: "toolResult",
        toolCallId: "call_write",
        toolName: "write",
        isError: false,
        content: [{ type: "text", text: JSON.stringify({ path: join(paths.workspace, "workflow.txt"), bytesWritten: 11 }, null, 2) }],
      }),
      expect.objectContaining({ role: "assistant", stopReason: "stop" }),
    ]);
    expectSessionEventTypes(session, ["system", "user_message", "assistant_message", "tool_result_message", "assistant_message"]);
    expectToolResultsToMatchAssistantCalls(messages);
  });

  it("runs a real write-edit-read workflow and keeps tool results paired with tool calls", async () => {
    const { Agent } = await import("../src/agent/agent.js");
    const agent = await Agent.create();

    streamSimpleMock
      .mockImplementationOnce(() => createToolUseEventStream({
        id: "call_write",
        name: "write",
        arguments: { path: "workflow.txt", content: "alpha\nbeta\n" },
      }))
      .mockImplementationOnce(() => createToolUseEventStream({
        id: "call_edit",
        name: "edit",
        arguments: { path: "workflow.txt", startLine: 2, endLine: 2, newText: "gamma" },
      }))
      .mockImplementationOnce(() => createToolUseEventStream({
        id: "call_read",
        name: "read",
        arguments: { path: "workflow.txt" },
      }))
      .mockImplementationOnce(() => createAssistantDoneEventStream("Updated and verified workflow.txt."));

    const result = await agent.runLoop("create, update, and verify workflow file");

    expect(result).toMatchObject({ text: "Updated and verified workflow.txt.", stopReason: "stop" });
    expect(await readFile(join(paths.workspace, "workflow.txt"), "utf8")).toBe("alpha\ngamma\n");

    const session = await loadOnlySession(paths);
    const messages = getSessionMessages(session);
    const toolResults = getToolResultMessages(session);

    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
      "toolResult",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    expect(toolResults).toHaveLength(3);
    expect(toolResults.map((message) => ({ toolCallId: message.toolCallId, toolName: message.toolName, isError: message.isError }))).toEqual([
      { toolCallId: "call_write", toolName: "write", isError: false },
      { toolCallId: "call_edit", toolName: "edit", isError: false },
      { toolCallId: "call_read", toolName: "read", isError: false },
    ]);
    expect(getToolResultText(toolResults[2]!)).toBe("alpha\ngamma\n");
    expectSessionEventTypes(session, [
      "system",
      "user_message",
      "assistant_message",
      "tool_result_message",
      "assistant_message",
      "tool_result_message",
      "assistant_message",
      "tool_result_message",
      "assistant_message",
    ]);
    expectToolResultsToMatchAssistantCalls(messages);
  });

  it("persists tool errors from a real filesystem workflow and continues the loop", async () => {
    const { Agent } = await import("../src/agent/agent.js");
    const agent = await Agent.create();

    streamSimpleMock
      .mockImplementationOnce(() => createToolUseEventStream({
        id: "call_write",
        name: "write",
        arguments: { path: "workflow.txt", content: "alpha\nbeta\n" },
      }))
      .mockImplementationOnce(() => createToolUseEventStream({
        id: "call_edit_error",
        name: "edit",
        arguments: { path: "workflow.txt", startLine: 4, endLine: 4, newText: "gamma" },
      }))
      .mockImplementationOnce(() => createAssistantDoneEventStream("Edit failed but the file stayed unchanged."));

    const result = await agent.runLoop("create file and try an invalid edit");

    expect(result).toMatchObject({ text: "Edit failed but the file stayed unchanged.", stopReason: "stop" });
    expect(await readFile(join(paths.workspace, "workflow.txt"), "utf8")).toBe("alpha\nbeta\n");

    const session = await loadOnlySession(paths);
    const messages = getSessionMessages(session);
    const toolResults = getToolResultMessages(session);

    expect(toolResults).toHaveLength(2);
    expect(toolResults.map((message) => ({ toolCallId: message.toolCallId, toolName: message.toolName, isError: message.isError }))).toEqual([
      { toolCallId: "call_write", toolName: "write", isError: false },
      { toolCallId: "call_edit_error", toolName: "edit", isError: true },
    ]);
    expect(getToolResultText(toolResults[1]!)).toContain("line range is out of bounds");
    expectSessionEventTypes(session, [
      "system",
      "user_message",
      "assistant_message",
      "tool_result_message",
      "assistant_message",
      "tool_result_message",
      "assistant_message",
    ]);
    expectToolResultsToMatchAssistantCalls(messages);
  });

  it("fails fast when an explicit session id does not exist", async () => {
    const { Agent } = await import("../src/agent/agent.js");
    await expect(Agent.createForSession(runtimeStateMock(), "missing-session")).rejects.toThrow("Unknown session missing-session.");
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
