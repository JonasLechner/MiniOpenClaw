import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runPromptInDetachedSessionMock = vi.fn();

vi.mock("../src/gateway/agent-runner.js", () => ({
  runPromptInDetachedSession: runPromptInDetachedSessionMock,
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-31T10:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("background task launcher", () => {
  it("runs a detached prompt, sends the result, and ingests it into the parent session", async () => {
    runPromptInDetachedSessionMock.mockResolvedValue({
      sessionId: "detached-1",
      text: "background reply",
      stopReason: "stop",
    });

    const sendText = vi.fn(async () => {});
    const appendUserMessage = vi.fn(async () => {});

    const { createBackgroundTaskLauncher } = await import("../src/jobs/background.js");
    const launcher = createBackgroundTaskLauncher(
      { paths: {} } as never,
      { sendText } as never,
      { appendUserMessage } as never,
    );

    const result = await launcher.launchDetachedPrompt({
      chatId: "chat-1",
      userId: "user-1",
      parentSessionId: "session-1",
      prompt: "do work",
    });

    expect(result.taskId).toBeTypeOf("string");
    await vi.waitFor(() => {
      expect(runPromptInDetachedSessionMock).toHaveBeenCalledWith(
        { paths: {} },
        "do work",
        expect.objectContaining({
          source: "telegram-detached",
          chatId: "chat-1",
          userId: "user-1",
        }),
        expect.objectContaining({ sandboxSessionId: "session-1", signal: expect.any(AbortSignal) }),
      );
      expect(sendText).toHaveBeenCalledWith("chat-1", "background reply");
      expect(appendUserMessage).toHaveBeenCalledWith("session-1", expect.stringContaining("Background subagent"));
      expect(appendUserMessage).toHaveBeenCalledWith("session-1", expect.stringContaining("do work"));
      expect(appendUserMessage).toHaveBeenCalledWith("session-1", expect.stringContaining("detached-1"));
    });
  });

  it("lists and stops queued tasks", async () => {
    let releaseFirst: (() => void) | undefined;
    runPromptInDetachedSessionMock.mockImplementationOnce(async () => new Promise((resolve) => {
      releaseFirst = () => resolve({ sessionId: "detached-1", text: "done", stopReason: "stop" });
    }));

    const { createBackgroundTaskLauncher } = await import("../src/jobs/background.js");
    const launcher = createBackgroundTaskLauncher(
      { paths: {} } as never,
      { sendText: vi.fn(async () => {}) } as never,
      { appendUserMessage: vi.fn(async () => {}) } as never,
    );

    await launcher.launchDetachedPrompt({
      chatId: "chat-1",
      parentSessionId: "session-1",
      prompt: "first",
    });
    const task = await launcher.launchDetachedPrompt({
      chatId: "chat-1",
      parentSessionId: "session-1",
      prompt: "queued second",
    });

    await vi.waitFor(async () => {
      const tasks = await launcher.listTasks({ parentSessionId: "session-1" });
      expect(tasks.find((entry) => entry.prompt === "first")?.status).toBe("running");
      expect(tasks.find((entry) => entry.taskId === task.taskId)?.status).toBe("queued");
    });

    const stopped = await launcher.stopTask({ parentSessionId: "session-1", taskId: task.taskId });
    expect(stopped).toEqual({ stopped: true, reason: `Stopped background task ${task.taskId}.` });

    const listedAfterStop = await launcher.listTasks({ parentSessionId: "session-1" });
    expect(listedAfterStop.find((entry) => entry.taskId === task.taskId)?.status).toBe("aborted");
    releaseFirst?.();
  });

  it("aborts running tasks", async () => {
    runPromptInDetachedSessionMock.mockImplementation(async (_runtime, _prompt, _context, options) => new Promise((resolve) => {
      options?.signal?.addEventListener("abort", () => {
        resolve({ sessionId: "detached-1", text: "Stopped.", stopReason: "aborted" });
      }, { once: true });
      setTimeout(() => {
        resolve({ sessionId: "detached-1", text: "background reply", stopReason: "stop" });
      }, 100);
    }));

    const sendText = vi.fn(async () => {});
    const appendUserMessage = vi.fn(async () => {});
    const { createBackgroundTaskLauncher } = await import("../src/jobs/background.js");
    const launcher = createBackgroundTaskLauncher(
      { paths: {} } as never,
      { sendText } as never,
      { appendUserMessage } as never,
    );

    const task = await launcher.launchDetachedPrompt({
      chatId: "chat-1",
      parentSessionId: "session-1",
      prompt: "do work",
    });

    await vi.waitFor(async () => {
      const tasks = await launcher.listTasks({ parentSessionId: "session-1" });
      expect(tasks[0]?.status).toBe("running");
    });

    expect(await launcher.stopTask({ parentSessionId: "session-1", taskId: task.taskId })).toEqual({
      stopped: true,
      reason: `Stopping background task ${task.taskId}…`,
    });

    await vi.waitFor(async () => {
      const tasks = await launcher.listTasks({ parentSessionId: "session-1" });
      expect(tasks[0]?.status).toBe("aborted");
      expect(sendText).toHaveBeenCalledWith("chat-1", "Stopped.");
      expect(appendUserMessage).toHaveBeenCalledWith("session-1", expect.stringContaining("do work"));
      expect(appendUserMessage).toHaveBeenCalledWith("session-1", expect.stringContaining("Stop reason: aborted"));
    });
  });

  it("marks the task failed when result publication fails", async () => {
    runPromptInDetachedSessionMock.mockResolvedValue({
      sessionId: "detached-1",
      text: "background reply",
      stopReason: "stop",
    });
    const sendText = vi.fn(async () => {
      throw new Error("telegram down");
    });
    const appendUserMessage = vi.fn(async () => {});

    const { createBackgroundTaskLauncher } = await import("../src/jobs/background.js");
    const launcher = createBackgroundTaskLauncher(
      { paths: {} } as never,
      { sendText } as never,
      { appendUserMessage } as never,
    );

    const task = await launcher.launchDetachedPrompt({
      chatId: "chat-1",
      parentSessionId: "session-1",
      prompt: "do work",
    });

    await vi.waitFor(async () => {
      const tasks = await launcher.listTasks({ parentSessionId: "session-1" });
      expect(tasks.find((entry) => entry.taskId === task.taskId)?.status).toBe("failed");
      expect(tasks.find((entry) => entry.taskId === task.taskId)?.errorMessage).toContain("Failed to publish background task");
    });
    expect(appendUserMessage).not.toHaveBeenCalled();
  });

  it("sends and ingests failures", async () => {
    runPromptInDetachedSessionMock.mockRejectedValue(new Error("boom"));
    const sendText = vi.fn(async () => {});
    const appendUserMessage = vi.fn(async () => {});

    const { createBackgroundTaskLauncher } = await import("../src/jobs/background.js");
    const launcher = createBackgroundTaskLauncher(
      { paths: {} } as never,
      { sendText } as never,
      { appendUserMessage } as never,
    );

    const result = await launcher.launchDetachedPrompt({
      chatId: "chat-1",
      parentSessionId: "session-1",
      prompt: "do work",
    });

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledWith("chat-1", expect.stringContaining(`Background task ${result.taskId} failed: boom`));
      expect(appendUserMessage).toHaveBeenCalledWith("session-1", expect.stringContaining(`Background subagent ${result.taskId} failed`));
      expect(appendUserMessage).toHaveBeenCalledWith("session-1", expect.stringContaining("do work"));
    });
  });

  it("keeps completed tasks for 12 hours and lists all active tasks plus only the 3 most recent terminal tasks", async () => {
    runPromptInDetachedSessionMock.mockResolvedValue({
      sessionId: "detached-1",
      text: "background reply",
      stopReason: "stop",
    });

    const { createBackgroundTaskLauncher } = await import("../src/jobs/background.js");
    const launcher = createBackgroundTaskLauncher(
      { paths: {} } as never,
      { sendText: vi.fn(async () => {}) } as never,
      { appendUserMessage: vi.fn(async () => {}) } as never,
    );

    for (const prompt of ["one", "two", "three", "four"]) {
      await launcher.launchDetachedPrompt({
        chatId: "chat-1",
        parentSessionId: "session-1",
        prompt,
      });
      await vi.runAllTimersAsync();
      vi.setSystemTime(new Date(Date.now() + 1_000));
    }

    let releaseRunning: (() => void) | undefined;
    runPromptInDetachedSessionMock.mockImplementationOnce(async () => new Promise((resolve) => {
      releaseRunning = () => resolve({ sessionId: "detached-running", text: "still running", stopReason: "stop" });
    }));
    await launcher.launchDetachedPrompt({
      chatId: "chat-1",
      parentSessionId: "session-1",
      prompt: "five",
    });
    await launcher.launchDetachedPrompt({
      chatId: "chat-1",
      parentSessionId: "session-1",
      prompt: "six",
    });

    const recentTasks = await launcher.listTasks({ parentSessionId: "session-1" });
    expect(recentTasks).toHaveLength(5);
    expect(new Set(recentTasks.slice(0, 2).map((task) => task.prompt))).toEqual(new Set(["five", "six"]));
    expect(recentTasks.slice(2).map((task) => task.prompt)).toEqual(["four", "three", "two"]);
    expect(recentTasks.filter((task) => task.status === "queued" || task.status === "running")).toHaveLength(2);

    releaseRunning?.();
    await vi.runAllTimersAsync();

    vi.setSystemTime(new Date("2026-05-31T22:00:01.000Z"));
    expect((await launcher.listTasks({ parentSessionId: "session-1" })).length).toBeGreaterThan(0);

    vi.setSystemTime(new Date("2026-05-31T22:00:06.001Z"));
    expect(await launcher.listTasks({ parentSessionId: "session-1" })).toEqual([]);
  });
});
