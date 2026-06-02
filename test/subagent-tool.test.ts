import { describe, expect, it, vi } from "vitest";

describe("subagent tool", () => {
  it("starts a detached background prompt from a bound chat session", async () => {
    const { subagentTool } = await import("../src/agent/tools/subagent.js");
    const launchDetachedPrompt = vi.fn(async () => ({ taskId: "task-1" }));

    const result = await subagentTool.run(
      { action: "start", prompt: "investigate this repo" },
      {
        workspace: {} as never,
        sandbox: {} as never,
        channel: {
          source: "telegram",
          chatId: "chat-1",
          userId: "user-1",
          sessionId: "session-1",
        },
        background: { launchDetachedPrompt, listTasks: vi.fn(), stopTask: vi.fn() },
      },
    );

    expect(launchDetachedPrompt).toHaveBeenCalledWith({
      chatId: "chat-1",
      userId: "user-1",
      parentSessionId: "session-1",
      prompt: "investigate this repo",
    });
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Started background subagent task-1."),
    });
  });

  it("lists background subagents for the bound session", async () => {
    const { subagentTool } = await import("../src/agent/tools/subagent.js");
    const listTasks = vi.fn(async () => [{
      taskId: "task-1",
      chatId: "chat-1",
      parentSessionId: "session-1",
      prompt: "investigate",
      status: "queued" as const,
      createdAt: "now",
    }]);

    const result = await subagentTool.run(
      { action: "list" },
      {
        workspace: {} as never,
        sandbox: {} as never,
        channel: {
          source: "telegram",
          chatId: "chat-1",
          userId: "user-1",
          sessionId: "session-1",
        },
        background: { launchDetachedPrompt: vi.fn(), listTasks, stopTask: vi.fn() },
      },
    );

    expect(listTasks).toHaveBeenCalledWith({ parentSessionId: "session-1" });
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("task-1 [queued]"),
    });
  });

  it("rejects use outside a bound chat session", async () => {
    const { subagentTool } = await import("../src/agent/tools/subagent.js");

    await expect(subagentTool.run(
      { action: "list" },
      {
        workspace: {} as never,
        sandbox: {} as never,
      },
    )).rejects.toThrow("subagent is only available from a bound chat session");
  });

  it("rejects use when no background launcher is available", async () => {
    const { subagentTool } = await import("../src/agent/tools/subagent.js");

    await expect(subagentTool.run(
      { action: "list" },
      {
        workspace: {} as never,
        sandbox: {} as never,
        channel: {
          source: "telegram",
          chatId: "chat-1",
          userId: "user-1",
          sessionId: "session-1",
        },
      },
    )).rejects.toThrow("subagent background launcher is unavailable in this runtime");
  });

  it("validates required start and stop arguments", async () => {
    const { subagentTool } = await import("../src/agent/tools/subagent.js");
    const context = {
      workspace: {} as never,
      sandbox: {} as never,
      channel: {
        source: "telegram",
        chatId: "chat-1",
        userId: "user-1",
        sessionId: "session-1",
      },
      background: { launchDetachedPrompt: vi.fn(), listTasks: vi.fn(), stopTask: vi.fn() },
    };

    await expect(subagentTool.run({ action: "start" } as never, context)).rejects.toThrow("prompt is required for subagent start");
    await expect(subagentTool.run({ action: "stop" } as never, context)).rejects.toThrow("taskId is required for subagent stop");
  });

  it("stops a background subagent for the bound session", async () => {
    const { subagentTool } = await import("../src/agent/tools/subagent.js");
    const stopTask = vi.fn(async () => ({ stopped: true, reason: "Stopping background task task-1…" }));

    const result = await subagentTool.run(
      { action: "stop", taskId: "task-1" },
      {
        workspace: {} as never,
        sandbox: {} as never,
        channel: {
          source: "telegram",
          chatId: "chat-1",
          userId: "user-1",
          sessionId: "session-1",
        },
        background: { launchDetachedPrompt: vi.fn(), listTasks: vi.fn(), stopTask },
      },
    );

    expect(stopTask).toHaveBeenCalledWith({ parentSessionId: "session-1", taskId: "task-1" });
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: "Stopping background task task-1…",
    });
  });
});
