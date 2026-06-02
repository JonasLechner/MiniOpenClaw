import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimePaths } from "../src/core/config.js";
import type { RuntimeState } from "../src/core/runtime.js";
import { createNewSession } from "../src/core/sessions.js";
import type { ConversationBinding } from "../src/core/conversation-bindings.js";
import { handleTelegramCommand, TELEGRAM_BOT_COMMANDS } from "../src/transports/telegram/commands.js";

function createRuntimePaths(): RuntimePaths {
  const root = mkdtempSync(join(tmpdir(), "miniopenclaw-telegram-commands-test-"));
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

function createRuntime(paths: RuntimePaths): RuntimeState {
  return {
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
    },
    paths,
  };
}

describe("telegram commands", () => {
  const roots: string[] = [];

  it("exports previewable Telegram bot commands", () => {
    expect(TELEGRAM_BOT_COMMANDS).toEqual([
      { command: "new", description: "Start a new session" },
      { command: "session", description: "Show the current session id" },
      { command: "bg", description: "Run a prompt in the background" },
      { command: "bglist", description: "List background tasks for this session" },
      { command: "bgstop", description: "Stop a background task" },
      { command: "compact", description: "Compact the current session" },
      { command: "stop", description: "Abort the current run" },
    ]);
    expect(TELEGRAM_BOT_COMMANDS.every(({ command }) => !command.startsWith("/"))).toBe(true);
  });

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  it("does not handle /help", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const runtime = createRuntime(paths);

    const binding: ConversationBinding = {
      channel: "telegram",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: "session-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const sendText = vi.fn<(chatId: string, text: string) => Promise<void>>(async () => {});
    const result = await handleTelegramCommand("/help", {
      runtime,
      binding,
      streamer: { sendText } as never,
    });

    expect(result).toEqual({ handled: false });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("shows session, model, and active run status", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const runtime = createRuntime(paths);

    const binding: ConversationBinding = {
      channel: "telegram",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: "session-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const sendText = vi.fn<(chatId: string, text: string) => Promise<void>>(async () => {});
    const result = await handleTelegramCommand("/session", {
      runtime,
      binding,
      streamer: { sendText } as never,
      getStatus: () => ({ provider: "openai", modelId: "gpt-test", activeRunStartedAt: "2026-05-31T10:00:00.000Z" }),
    });

    expect(result).toEqual({ handled: true });
    expect(sendText).toHaveBeenCalledWith("chat-1", [
      "Current session: session-1",
      "Model: openai/gpt-test",
      "Active run since: 2026-05-31T10:00:00.000Z",
    ].join("\n"));
  });

  it("starts a background task with /bg", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const runtime = createRuntime(paths);

    const binding: ConversationBinding = {
      channel: "telegram",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: "session-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const sendText = vi.fn<(chatId: string, text: string) => Promise<void>>(async () => {});
    const launchDetachedPrompt = vi.fn(async () => ({ taskId: "task-1" }));
    const result = await handleTelegramCommand("/bg investigate this repo", {
      runtime,
      binding,
      streamer: { sendText } as never,
      backgroundTaskLauncher: { launchDetachedPrompt, listTasks: vi.fn(), stopTask: vi.fn() },
    });

    expect(result).toEqual({ handled: true });
    expect(launchDetachedPrompt).toHaveBeenCalledWith({
      chatId: "chat-1",
      userId: "user-1",
      parentSessionId: "session-1",
      prompt: "investigate this repo",
    });
    expect(sendText).toHaveBeenCalledWith("chat-1", expect.stringContaining("Started background task task-1."));
  });

  it("lists background tasks with /bglist", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const runtime = createRuntime(paths);

    const binding: ConversationBinding = {
      channel: "telegram",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: "session-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const sendText = vi.fn<(chatId: string, text: string) => Promise<void>>(async () => {});
    const listTasks = vi.fn(async () => [{
      taskId: "task-1",
      chatId: "chat-1",
      parentSessionId: "session-1",
      prompt: "work",
      status: "running" as const,
      createdAt: "now",
    }]);
    const result = await handleTelegramCommand("/bglist", {
      runtime,
      binding,
      streamer: { sendText } as never,
      backgroundTaskLauncher: { launchDetachedPrompt: vi.fn(), listTasks, stopTask: vi.fn() },
    });

    expect(result).toEqual({ handled: true });
    expect(listTasks).toHaveBeenCalledWith({ parentSessionId: "session-1" });
    expect(sendText).toHaveBeenCalledWith("chat-1", expect.stringContaining("task-1 [running]"));
  });

  it("stops a background task with /bgstop", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const runtime = createRuntime(paths);

    const binding: ConversationBinding = {
      channel: "telegram",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: "session-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const sendText = vi.fn<(chatId: string, text: string) => Promise<void>>(async () => {});
    const stopTask = vi.fn(async () => ({ stopped: true, reason: "Stopping background task task-1…" }));
    const result = await handleTelegramCommand("/bgstop task-1", {
      runtime,
      binding,
      streamer: { sendText } as never,
      backgroundTaskLauncher: { launchDetachedPrompt: vi.fn(), listTasks: vi.fn(), stopTask },
    });

    expect(result).toEqual({ handled: true });
    expect(stopTask).toHaveBeenCalledWith({ parentSessionId: "session-1", taskId: "task-1" });
    expect(sendText).toHaveBeenCalledWith("chat-1", "Stopping background task task-1…");
  });

  it("compacts the current session with /compact", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const runtime = createRuntime(paths);

    const binding: ConversationBinding = {
      channel: "telegram",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: "session-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const sendText = vi.fn<(chatId: string, text: string) => Promise<void>>(async () => {});
    const compactSession = vi.fn(async () => ({ compacted: true, estimatedTokensBefore: 112000, estimatedTokensAfter: 28000 }));
    const result = await handleTelegramCommand("/compact", {
      runtime,
      binding,
      streamer: { sendText } as never,
      compactSession,
    });

    expect(result).toEqual({ handled: true });
    expect(compactSession).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenNthCalledWith(1, "chat-1", "Compacting...");
    expect(sendText).toHaveBeenNthCalledWith(2, "chat-1", "Compacted session session-1: ~112000 -> ~28000 estimated tokens.");
  });

  it("stops an active run", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const runtime = createRuntime(paths);

    const binding: ConversationBinding = {
      channel: "telegram",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: "session-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const sendText = vi.fn<(chatId: string, text: string) => Promise<void>>(async () => {});
    const stopActiveRun = vi.fn(() => true);
    const result = await handleTelegramCommand("/stop@MiniOpenClawBot", {
      runtime,
      binding,
      streamer: { sendText } as never,
      stopActiveRun,
    });

    expect(result).toEqual({ handled: true });
    expect(stopActiveRun).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("chat-1", "Stopping current run…");
  });

  it("switches the binding to a newly created session", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);

    const existingSession = await createNewSession(paths);
    const runtime = createRuntime(paths);

    const binding: ConversationBinding = {
      channel: "telegram",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: existingSession.sessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const sendText = vi.fn<(chatId: string, text: string) => Promise<void>>(async () => {});
    const result = await handleTelegramCommand("/new", {
      runtime,
      binding,
      streamer: { sendText } as never,
    });

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("expected command to be handled");
    expect(result).toMatchObject({ sessionId: expect.any(String) });
    expect(result.sessionId).not.toBe(existingSession.sessionId);
    expect(sendText).toHaveBeenCalledWith("chat-1", expect.stringContaining(result.sessionId!));
  });
});
