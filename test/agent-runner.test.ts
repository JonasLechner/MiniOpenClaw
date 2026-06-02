import { afterEach, describe, expect, it, vi } from "vitest";

const createForSessionMock = vi.fn();
const createNewSessionMock = vi.fn(async () => ({ sessionId: "detached-session" }));
const disposeMock = vi.fn(async () => {});
const appendUserMessageMock = vi.fn(async () => {});
const runLoopMock = vi.fn(async (prompt: string) => ({ text: `reply:${prompt}`, stopReason: "stop" }));

vi.mock("../src/agent/agent.js", () => ({
  Agent: {
    createForSession: createForSessionMock,
  },
}));

vi.mock("../src/lib/sessions.js", () => ({
  createNewSession: createNewSessionMock,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("gateway agent runner", () => {
  it("reuses the same in-memory agent for repeated prompts in one session", async () => {
    createForSessionMock.mockResolvedValue({ runLoop: runLoopMock, appendUserMessage: appendUserMessageMock, dispose: disposeMock });

    const runtime = { paths: {} } as never;
    const { createMainSessionAgent } = await import("../src/gateway/agent-runner.js");
    const mainSessionAgent = createMainSessionAgent(runtime);

    await mainSessionAgent.runPrompt("session-1", "first");
    await mainSessionAgent.runPrompt("session-1", "second");

    expect(createForSessionMock).toHaveBeenCalledTimes(1);
    expect(createForSessionMock).toHaveBeenCalledWith(runtime, "session-1");
    expect(runLoopMock).toHaveBeenCalledTimes(2);
  });

  it("swaps the live agent when the session changes", async () => {
    createForSessionMock.mockResolvedValue({ runLoop: runLoopMock, appendUserMessage: appendUserMessageMock, dispose: disposeMock });

    const runtime = { paths: {} } as never;
    const { createMainSessionAgent } = await import("../src/gateway/agent-runner.js");
    const mainSessionAgent = createMainSessionAgent(runtime);

    await mainSessionAgent.runPrompt("session-1", "first");
    await mainSessionAgent.bindSession("session-2");

    expect(disposeMock).toHaveBeenCalledTimes(1);
    expect(createForSessionMock).toHaveBeenCalledTimes(2);
    expect(createForSessionMock).toHaveBeenNthCalledWith(1, runtime, "session-1");
    expect(createForSessionMock).toHaveBeenNthCalledWith(2, runtime, "session-2");
  });

  it("serializes append-only mutations behind active turns", async () => {
    let releaseRunLoop: (() => void) | undefined;
    runLoopMock.mockImplementationOnce(() => new Promise((resolve) => {
      releaseRunLoop = () => resolve({ text: "done", stopReason: "stop" });
    }));
    createForSessionMock.mockResolvedValue({ runLoop: runLoopMock, appendUserMessage: appendUserMessageMock, dispose: disposeMock });

    const runtime = { paths: {} } as never;
    const { createMainSessionAgent } = await import("../src/gateway/agent-runner.js");
    const mainSessionAgent = createMainSessionAgent(runtime);

    const runningTurn = mainSessionAgent.runPrompt("session-1", "first");
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
    createForSessionMock.mockResolvedValue({ runLoop: runLoopMock, appendUserMessage: appendUserMessageMock, dispose: disposeMock });

    const runtime = { paths: {} } as never;
    const { runPromptInDetachedSession } = await import("../src/gateway/agent-runner.js");

    await runPromptInDetachedSession(runtime, "hello");

    expect(createNewSessionMock).toHaveBeenCalledWith(runtime.paths);
    expect(createForSessionMock).toHaveBeenCalledTimes(1);
    expect(createForSessionMock).toHaveBeenCalledWith(runtime, "detached-session");
    expect(disposeMock).toHaveBeenCalledTimes(1);
  });
});
