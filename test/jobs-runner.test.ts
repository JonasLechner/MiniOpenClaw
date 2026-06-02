import { afterEach, describe, expect, it, vi } from "vitest";

const getTelegramConversationBindingByChatIdMock = vi.fn();
const runPromptInDetachedSessionMock = vi.fn();

vi.mock("../src/core/conversation-bindings.js", () => ({
  getTelegramConversationBindingByChatId: getTelegramConversationBindingByChatIdMock,
}));

vi.mock("../src/gateway/agent-runner.js", () => ({
  runPromptInDetachedSession: runPromptInDetachedSessionMock,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("runScheduledTask", () => {
  it("uses the current main session binding for main-session prompt jobs", async () => {
    getTelegramConversationBindingByChatIdMock.mockResolvedValue({ sessionId: "session-current" });

    const { runScheduledTask } = await import("../src/jobs/runner.js");
    const streamer = { sendText: vi.fn(async () => {}) };
    const mainSessionAgent = {
      runPrompt: vi.fn(async () => ({ text: "main reply", stopReason: "stop" })),
      appendUserMessage: vi.fn(),
    };

    await runScheduledTask({ paths: {} } as never, streamer as never, {
      id: "job-1",
      channel: "telegram",
      chatId: "chat-1",
      target: "main-session",
      kind: "prompt",
      prompt: "hello",
      cron: "* * * * *",
      enabled: true,
      createdAt: "now",
      updatedAt: "now",
    }, mainSessionAgent as never);

    expect(getTelegramConversationBindingByChatIdMock).toHaveBeenCalledWith({}, "chat-1");
    expect(mainSessionAgent.runPrompt).toHaveBeenCalledWith("session-current", "hello", {
      source: "scheduled-main-session",
      chatId: "chat-1",
      taskId: "job-1",
    });
    expect(streamer.sendText).toHaveBeenCalledWith("chat-1", "main reply");
  });

  it("uses a detached session with the current main session sandbox and injects the result into the main session", async () => {
    runPromptInDetachedSessionMock.mockResolvedValue({ text: "detached reply", stopReason: "stop" });
    getTelegramConversationBindingByChatIdMock.mockResolvedValue({ sessionId: "session-current" });

    const { runScheduledTask } = await import("../src/jobs/runner.js");
    const streamer = { sendText: vi.fn(async () => {}) };
    const mainSessionAgent = {
      runPrompt: vi.fn(),
      appendUserMessage: vi.fn(async () => {}),
    };

    await runScheduledTask({ paths: {} } as never, streamer as never, {
      id: "job-2",
      channel: "telegram",
      chatId: "chat-1",
      target: "detached",
      kind: "prompt",
      prompt: "hello detached",
      cron: "* * * * *",
      enabled: true,
      createdAt: "now",
      updatedAt: "now",
    }, mainSessionAgent as never);

    expect(getTelegramConversationBindingByChatIdMock).toHaveBeenCalledWith({}, "chat-1");
    expect(runPromptInDetachedSessionMock).toHaveBeenCalledWith(
      { paths: {} },
      "hello detached",
      {
        source: "scheduled-detached",
        chatId: "chat-1",
        taskId: "job-2",
      },
      { sandboxSessionId: "session-current" },
    );
    expect(streamer.sendText).toHaveBeenCalledWith("chat-1", "detached reply");
    expect(mainSessionAgent.appendUserMessage).toHaveBeenCalledTimes(1);
    expect(mainSessionAgent.appendUserMessage).toHaveBeenCalledWith(
      "session-current",
      expect.stringContaining("Detached task completed"),
    );
    expect(mainSessionAgent.appendUserMessage).toHaveBeenCalledWith(
      "session-current",
      expect.stringContaining("detached reply"),
    );
  });
});
