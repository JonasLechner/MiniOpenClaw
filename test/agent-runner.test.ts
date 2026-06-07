import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeState } from "../src/core/runtime.js";
import { fullToolRegistry } from "../src/agent/tools/full-tool-registry.js";

const createForSessionMock = vi.fn();
const createNewSessionMock = vi.fn(async () => ({ sessionId: "detached-session" }));
const disposeMock = vi.fn(async () => {});
const appendUserMessageMock = vi.fn(async () => {});
const compactSessionMock = vi.fn(async () => ({ compacted: true, estimatedTokensBefore: 100_000, estimatedTokensAfter: 25_000 }));
const runLoopMock = vi.fn(async (prompt: string) => ({ text: `reply:${prompt}`, stopReason: "stop" }));

vi.mock("../src/agent/agent.js", () => ({
  Agent: {
    createForSession: createForSessionMock,
  },
}));

vi.mock("../src/core/sessions.js", () => ({
  createNewSession: createNewSessionMock,
}));

afterEach(() => {
  vi.clearAllMocks();
  compactSessionMock.mockResolvedValue({ compacted: true, estimatedTokensBefore: 100_000, estimatedTokensAfter: 25_000 });
});

describe("gateway agent runner", () => {
  it("reuses the same in-memory agent for repeated prompts in one session", async () => {
    createForSessionMock.mockResolvedValue({ runLoop: runLoopMock, appendUserMessage: appendUserMessageMock, compactSession: compactSessionMock, dispose: disposeMock });

    const runtime = { paths: {} } as never;
    const { createMainSessionAgent } = await import("../src/gateway/agent-runner.js");
    const mainSessionAgent = createMainSessionAgent(runtime);

    await mainSessionAgent.runPrompt("session-1", "first", { source: "telegram", chatId: "chat-1" });
    await mainSessionAgent.runPrompt("session-1", "second", { source: "telegram", chatId: "chat-1" });

    expect(createForSessionMock).toHaveBeenCalledTimes(1);
    expect(createForSessionMock).toHaveBeenCalledWith(runtime, "session-1", expect.objectContaining({ toolRegistry: fullToolRegistry }));
    expect(runLoopMock).toHaveBeenCalledTimes(2);
  });

  it("swaps the live agent when the session changes", async () => {
    createForSessionMock.mockResolvedValue({ runLoop: runLoopMock, appendUserMessage: appendUserMessageMock, compactSession: compactSessionMock, dispose: disposeMock });

    const runtime = { paths: {} } as never;
    const { createMainSessionAgent } = await import("../src/gateway/agent-runner.js");
    const mainSessionAgent = createMainSessionAgent(runtime);

    await mainSessionAgent.runPrompt("session-1", "first", { source: "telegram", chatId: "chat-1" });
    await mainSessionAgent.bindSession("session-2");

    expect(disposeMock).toHaveBeenCalledTimes(1);
    expect(createForSessionMock).toHaveBeenCalledTimes(2);
    expect(createForSessionMock).toHaveBeenNthCalledWith(1, runtime, "session-1", expect.objectContaining({ toolRegistry: fullToolRegistry }));
    expect(createForSessionMock).toHaveBeenNthCalledWith(2, runtime, "session-2", expect.objectContaining({ toolRegistry: fullToolRegistry }));
  });

  it("aborts the active run without disposing the agent", async () => {
    let capturedSignal: AbortSignal | undefined;
    let releaseRunLoop: (() => void) | undefined;
    runLoopMock.mockImplementationOnce((_prompt: string, options?: { signal?: AbortSignal }) => {
      capturedSignal = options?.signal;
      return new Promise((resolve) => {
        releaseRunLoop = () => resolve({ text: "Stopped.", stopReason: "aborted" });
      });
    });
    createForSessionMock.mockResolvedValue({ runLoop: runLoopMock, appendUserMessage: appendUserMessageMock, compactSession: compactSessionMock, dispose: disposeMock });

    const runtime = { paths: {} } as never;
    const { createMainSessionAgent } = await import("../src/gateway/agent-runner.js");
    const mainSessionAgent = createMainSessionAgent(runtime);

    const runningTurn = mainSessionAgent.runPrompt("session-1", "first", { source: "telegram", chatId: "chat-1" });

    await vi.waitFor(() => expect(capturedSignal).toBeDefined());
    expect(mainSessionAgent.stopActiveRun()).toBe(true);
    expect(capturedSignal?.aborted).toBe(true);
    expect(disposeMock).not.toHaveBeenCalled();
    expect(mainSessionAgent.stopActiveRun()).toBe(false);

    releaseRunLoop?.();
    await expect(runningTurn).resolves.toMatchObject({ stopReason: "aborted" });
  });

  it("serializes append-only mutations behind active turns", async () => {
    let releaseRunLoop: (() => void) | undefined;
    runLoopMock.mockImplementationOnce(() => new Promise((resolve) => {
      releaseRunLoop = () => resolve({ text: "done", stopReason: "stop" });
    }));
    createForSessionMock.mockResolvedValue({ runLoop: runLoopMock, appendUserMessage: appendUserMessageMock, compactSession: compactSessionMock, dispose: disposeMock });

    const runtime = { paths: {} } as never;
    const { createMainSessionAgent } = await import("../src/gateway/agent-runner.js");
    const mainSessionAgent = createMainSessionAgent(runtime);

    const runningTurn = mainSessionAgent.runPrompt("session-1", "first", { source: "telegram", chatId: "chat-1" });
    const queuedAppend = mainSessionAgent.appendUserMessage("session-1", "note");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(appendUserMessageMock).not.toHaveBeenCalled();
    expect(releaseRunLoop).toBeTypeOf("function");

    releaseRunLoop?.();
    await runningTurn;
    await queuedAppend;

    expect(appendUserMessageMock).toHaveBeenCalledWith("note");
  });

  it("disposes detached session agents after each run", async () => {
    createForSessionMock.mockResolvedValue({ runLoop: runLoopMock, appendUserMessage: appendUserMessageMock, compactSession: compactSessionMock, dispose: disposeMock });

    const runtime = { paths: {} } as unknown as RuntimeState;
    const { runPromptInDetachedSession } = await import("../src/gateway/agent-runner.js");

    await runPromptInDetachedSession(runtime, "hello", { source: "scheduled-detached", chatId: "chat-1", taskId: "task-1" });

    expect(createNewSessionMock).toHaveBeenCalledWith(runtime.paths);
    expect(createForSessionMock).toHaveBeenCalledTimes(1);
    expect(createForSessionMock).toHaveBeenCalledWith(runtime, "detached-session", expect.objectContaining({ sandboxSessionId: undefined, toolRegistry: fullToolRegistry }));
    expect(disposeMock).toHaveBeenCalledTimes(1);
  });

  it("can compact the current session through the shared agent lane", async () => {
    createForSessionMock.mockResolvedValue({ runLoop: runLoopMock, appendUserMessage: appendUserMessageMock, compactSession: compactSessionMock, dispose: disposeMock });

    const runtime = { paths: {} } as never;
    const { createMainSessionAgent } = await import("../src/gateway/agent-runner.js");
    const mainSessionAgent = createMainSessionAgent(runtime);

    await expect(mainSessionAgent.compactSession("session-1")).resolves.toMatchObject({ compacted: true, estimatedTokensAfter: 25_000 });
    expect(compactSessionMock).toHaveBeenCalledWith("manual", true);
  });

  it("can still target an explicit sandbox when requested", async () => {
    createForSessionMock.mockResolvedValue({ runLoop: runLoopMock, appendUserMessage: appendUserMessageMock, compactSession: compactSessionMock, dispose: disposeMock });

    const runtime = { paths: {} } as unknown as RuntimeState;
    const { runPromptInDetachedSession } = await import("../src/gateway/agent-runner.js");

    await runPromptInDetachedSession(
      runtime,
      "hello",
      { source: "scheduled-detached", chatId: "chat-1", taskId: "task-1" },
      { sandboxSessionId: "main-session" },
    );

    expect(createForSessionMock).toHaveBeenCalledWith(runtime, "detached-session", expect.objectContaining({ sandboxSessionId: "main-session", toolRegistry: fullToolRegistry }));
  });
});
