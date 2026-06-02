import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimePaths } from "../src/core/config.js";
import type { RuntimeState } from "../src/core/runtime.js";
import type { TelegramCommandResult } from "../src/transports/telegram/commands.js";

const resolveTelegramConversationBindingMock = vi.fn();
const logConversationMessageMock = vi.fn();
const handleTelegramCommandMock = vi.fn<() => Promise<TelegramCommandResult>>(async () => ({ handled: false }));
const createTelegramPollingMock = vi.fn();
const setMyCommandsMock = vi.fn(async () => true);
const getFileMock = vi.fn(async () => ({ file_unique_id: "unique-file", file_path: "photos/file.jpg" }));
const downloadFileMock = vi.fn(async () => Buffer.from("image-bytes"));
const sendMessageMock = vi.fn(async () => ({ message_id: 1, chat: { id: 1, type: "private" } }));
const editMessageTextMock = vi.fn(async (_chatId: string, messageId: number, text: string) => ({ message_id: messageId, text, chat: { id: 1, type: "private" } }));
const deleteMessageMock = vi.fn(async () => true);
const sendChatActionMock = vi.fn(async () => true);
const sendPhotoMock = vi.fn(async () => ({ message_id: 2, chat: { id: 1, type: "private" } }));
const statMock = vi.fn();

vi.mock("../src/core/conversation-bindings.js", () => ({
  resolveTelegramConversationBinding: resolveTelegramConversationBindingMock,
}));

vi.mock("../src/gateway/conversation-log.js", () => ({
  logConversationMessage: logConversationMessageMock,
}));

vi.mock("../src/transports/telegram/commands.js", () => ({
  TELEGRAM_BOT_COMMANDS: [],
  handleTelegramCommand: handleTelegramCommandMock,
}));

vi.mock("../src/transports/telegram/polling.js", () => ({
  createTelegramPolling: createTelegramPollingMock,
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    stat: statMock,
  };
});

vi.mock("../src/transports/telegram/api.js", () => ({
  TelegramApiClient: class {
    setMyCommands = setMyCommandsMock;
    getFile = getFileMock;
    downloadFile = downloadFileMock;
    sendMessage = sendMessageMock;
    editMessageText = editMessageTextMock;
    deleteMessage = deleteMessageMock;
    sendChatAction = sendChatActionMock;
    sendPhoto = sendPhotoMock;
  },
}));

function createRuntimePaths(): RuntimePaths {
  const root = mkdtempSync(join(tmpdir(), "miniopenclaw-telegram-app-test-"));
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
        telegram: { enabled: true, token: "token", polling: true, allowedUserIds: [] },
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

describe("telegram app", () => {
  const roots: string[] = [];

  statMock.mockImplementation(async (path: string) => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    return actual.stat(path);
  });

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
    statMock.mockReset();
    statMock.mockImplementation(async (path: string) => {
      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      return actual.stat(path);
    });
    vi.clearAllMocks();
  });

  it("processes inbound image documents even when Telegram omits the image mime type", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const runtime = createRuntime(paths);
    resolveTelegramConversationBindingMock.mockResolvedValue({ sessionId: "session-1" });

    let onUpdate: ((update: { message?: unknown }) => Promise<void>) | undefined;
    createTelegramPollingMock.mockImplementation((_api, handler) => {
      onUpdate = handler;
      return {
        start() {},
        async stop() {},
      };
    });

    const mainSessionAgent = {
      runPrompt: vi.fn(async (_sessionId: string, prompt: string) => ({ text: `saw ${prompt}`, stopReason: "stop" })),
      bindSession: vi.fn(async () => {}),
      appendUserMessage: vi.fn(async () => {}),
      setBackgroundTaskLauncher: vi.fn(),
      stopActiveRun: vi.fn(() => false),
      getStatus: vi.fn(() => ({ provider: "openai", modelId: "gpt-test" })),
      dispose: vi.fn(async () => {}),
    };

    const { buildTelegramGatewayApp } = await import("../src/transports/telegram/app.js");
    const app = buildTelegramGatewayApp(runtime, mainSessionAgent as never);
    expect(app).toBeDefined();
    await app?.start();

    expect(onUpdate).toBeTypeOf("function");
    await onUpdate?.({
      message: {
        message_id: 42,
        chat: { id: 123, type: "private" },
        from: { id: 456, first_name: "User" },
        document: {
          file_id: "file-1",
          file_unique_id: "unique-file",
          file_name: "photo.JPG",
          mime_type: "application/octet-stream",
        },
      },
    });

    expect(getFileMock).toHaveBeenCalledWith("file-1");
    expect(downloadFileMock).toHaveBeenCalledWith("photos/file.jpg");

    const prompt = mainSessionAgent.runPrompt.mock.calls[0]?.[1];
    expect(prompt).toContain("User sent an image.");
    expect(prompt).toContain("Image saved in the workspace at:");

    const savedPath = String(prompt).match(/Image saved in the workspace at: (.+)/)?.[1];
    expect(savedPath).toBeTruthy();
    expect(savedPath).toContain("telegram-attachments/123/42-unique-file.");
    expect(savedPath?.toLowerCase()).toContain(".jpg");
    expect(savedPath ? existsSync(savedPath) : false).toBe(true);

    expect(sendChatActionMock).toHaveBeenCalledWith("123", "typing");
    expect(sendMessageMock).toHaveBeenCalledWith("123", expect.stringContaining("saw User sent an image."));
    expect(sendMessageMock).not.toHaveBeenCalledWith("123", "Thinking…");
  });

  it("rejects unauthorized Telegram users before invoking the agent", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const runtime = {
      ...createRuntime(paths),
      config: {
        ...createRuntime(paths).config,
        gateway: {
          ...createRuntime(paths).config.gateway,
          telegram: { enabled: true, token: "token", polling: true, allowedUserIds: ["999"] },
        },
      },
    };

    let onUpdate: ((update: { message?: unknown }) => Promise<void>) | undefined;
    createTelegramPollingMock.mockImplementation((_api, handler) => {
      onUpdate = handler;
      return { start() {}, async stop() {} };
    });

    const mainSessionAgent = {
      runPrompt: vi.fn(async () => ({ text: "unused", stopReason: "stop" })),
      bindSession: vi.fn(async () => {}),
      appendUserMessage: vi.fn(async () => {}),
      setBackgroundTaskLauncher: vi.fn(),
      stopActiveRun: vi.fn(() => false),
      getStatus: vi.fn(() => ({ provider: "openai", modelId: "gpt-test" })),
      dispose: vi.fn(async () => {}),
    };

    const { buildTelegramGatewayApp } = await import("../src/transports/telegram/app.js");
    const app = buildTelegramGatewayApp(runtime, mainSessionAgent as never);
    await app?.start();

    await onUpdate?.({
      message: {
        message_id: 1,
        chat: { id: 123, type: "private" },
        from: { id: 456, first_name: "Blocked" },
        text: "hello",
      },
    });

    expect(sendMessageMock).toHaveBeenCalledWith("123", "Unauthorized Telegram user.");
    expect(mainSessionAgent.runPrompt).not.toHaveBeenCalled();
    expect(resolveTelegramConversationBindingMock).not.toHaveBeenCalled();
  });

  it("ignores non-private chats", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const runtime = createRuntime(paths);

    let onUpdate: ((update: { message?: unknown }) => Promise<void>) | undefined;
    createTelegramPollingMock.mockImplementation((_api, handler) => {
      onUpdate = handler;
      return { start() {}, async stop() {} };
    });

    const mainSessionAgent = {
      runPrompt: vi.fn(async () => ({ text: "unused", stopReason: "stop" })),
      bindSession: vi.fn(async () => {}),
      appendUserMessage: vi.fn(async () => {}),
      setBackgroundTaskLauncher: vi.fn(),
      stopActiveRun: vi.fn(() => false),
      getStatus: vi.fn(() => ({ provider: "openai", modelId: "gpt-test" })),
      dispose: vi.fn(async () => {}),
    };

    const { buildTelegramGatewayApp } = await import("../src/transports/telegram/app.js");
    const app = buildTelegramGatewayApp(runtime, mainSessionAgent as never);
    await app?.start();

    await onUpdate?.({
      message: {
        message_id: 2,
        chat: { id: 123, type: "group" },
        from: { id: 456, first_name: "User" },
        text: "hello group",
      },
    });

    expect(mainSessionAgent.runPrompt).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("binds a new session returned by a handled Telegram command", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const runtime = createRuntime(paths);
    resolveTelegramConversationBindingMock.mockResolvedValue({ sessionId: "session-1" });
    handleTelegramCommandMock.mockResolvedValueOnce({ handled: true, sessionId: "session-2" });

    let onUpdate: ((update: { message?: unknown }) => Promise<void>) | undefined;
    createTelegramPollingMock.mockImplementation((_api, handler) => {
      onUpdate = handler;
      return { start() {}, async stop() {} };
    });

    const mainSessionAgent = {
      runPrompt: vi.fn(async () => ({ text: "unused", stopReason: "stop" })),
      bindSession: vi.fn(async () => {}),
      appendUserMessage: vi.fn(async () => {}),
      setBackgroundTaskLauncher: vi.fn(),
      stopActiveRun: vi.fn(() => false),
      getStatus: vi.fn(() => ({ provider: "openai", modelId: "gpt-test" })),
      dispose: vi.fn(async () => {}),
    };

    const { buildTelegramGatewayApp } = await import("../src/transports/telegram/app.js");
    const app = buildTelegramGatewayApp(runtime, mainSessionAgent as never);
    await app?.start();

    await onUpdate?.({
      message: {
        message_id: 3,
        chat: { id: 123, type: "private" },
        from: { id: 456, first_name: "User" },
        text: "/new",
      },
    });

    expect(mainSessionAgent.bindSession).toHaveBeenCalledWith("session-2");
    expect(mainSessionAgent.runPrompt).not.toHaveBeenCalled();
  });

  it("lets /stop bypass the per-chat prompt queue", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const runtime = createRuntime(paths);
    resolveTelegramConversationBindingMock.mockResolvedValue({ sessionId: "session-1", chatId: "123", userId: "456" });

    let onUpdate: ((update: { message?: unknown }) => Promise<void>) | undefined;
    createTelegramPollingMock.mockImplementation((_api, handler) => {
      onUpdate = handler;
      return { start() {}, async stop() {} };
    });

    let releaseRunPrompt: (() => void) | undefined;
    const mainSessionAgent = {
      runPrompt: vi.fn(async () => await new Promise((resolve) => {
        releaseRunPrompt = () => resolve({ text: "Stopped.", stopReason: "aborted" });
      })),
      bindSession: vi.fn(async () => {}),
      appendUserMessage: vi.fn(async () => {}),
      setBackgroundTaskLauncher: vi.fn(),
      stopActiveRun: vi.fn(() => true),
      getStatus: vi.fn(() => ({ provider: "openai", modelId: "gpt-test" })),
      dispose: vi.fn(async () => {}),
    };

    handleTelegramCommandMock.mockImplementation(async (text: string, context: { streamer: { sendText(chatId: string, text: string): Promise<void> }; binding: { chatId: string }; stopActiveRun?: () => boolean }) => {
      if (text !== "/stop") return { handled: false };
      const stopped = context.stopActiveRun?.() ?? false;
      await context.streamer.sendText(context.binding.chatId, stopped ? "Stopping current run…" : "No active run to stop.");
      return { handled: true };
    });

    const { buildTelegramGatewayApp } = await import("../src/transports/telegram/app.js");
    const app = buildTelegramGatewayApp(runtime, mainSessionAgent as never);
    await app?.start();

    const runningUpdate = onUpdate?.({
      message: {
        message_id: 4,
        chat: { id: 123, type: "private" },
        from: { id: 456, first_name: "User" },
        text: "hello",
      },
    });

    await vi.waitFor(() => expect(mainSessionAgent.runPrompt).toHaveBeenCalledTimes(1));

    await onUpdate?.({
      message: {
        message_id: 5,
        chat: { id: 123, type: "private" },
        from: { id: 456, first_name: "User" },
        text: "/stop",
      },
    });

    expect(mainSessionAgent.stopActiveRun).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledWith("123", "Stopping current run…");

    releaseRunPrompt?.();
    await runningUpdate;
  });

  it("edits the Telegram reply while the agent streams deltas", async () => {
    vi.useFakeTimers();
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const runtime = createRuntime(paths);
    resolveTelegramConversationBindingMock.mockResolvedValue({ sessionId: "session-1" });

    let onUpdate: ((update: { message?: unknown }) => Promise<void>) | undefined;
    createTelegramPollingMock.mockImplementation((_api, handler) => {
      onUpdate = handler;
      return { start() {}, async stop() {} };
    });

    const mainSessionAgent = {
      runPrompt: vi.fn(async (_sessionId: string, _prompt: string, _logContext: unknown, options?: { onEvent?: (event: { type: string; delta?: string }) => void }) => {
        options?.onEvent?.({ type: "message_delta", delta: "Hello" });
        await Promise.resolve();
        options?.onEvent?.({ type: "message_delta", delta: " world" });
        await vi.advanceTimersByTimeAsync(500);
        return { text: "Hello world!", stopReason: "stop" };
      }),
      bindSession: vi.fn(async () => {}),
      appendUserMessage: vi.fn(async () => {}),
      setBackgroundTaskLauncher: vi.fn(),
      stopActiveRun: vi.fn(() => false),
      getStatus: vi.fn(() => ({ provider: "openai", modelId: "gpt-test" })),
      dispose: vi.fn(async () => {}),
    };

    const { buildTelegramGatewayApp } = await import("../src/transports/telegram/app.js");
    const app = buildTelegramGatewayApp(runtime, mainSessionAgent as never);
    await app?.start();

    await onUpdate?.({
      message: {
        message_id: 6,
        chat: { id: 123, type: "private" },
        from: { id: 456, first_name: "User" },
        text: "hello",
      },
    });

    expect(sendMessageMock).toHaveBeenCalledWith("123", "Hello");
    expect(editMessageTextMock).toHaveBeenCalledWith("123", 1, "Hello world");
    expect(editMessageTextMock).toHaveBeenCalledWith("123", 1, "Hello world!");
    vi.useRealTimers();
  });

  it("sends referenced workspace images back to Telegram", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const runtime = createRuntime(paths);
    resolveTelegramConversationBindingMock.mockResolvedValue({ sessionId: "session-1" });
    statMock.mockResolvedValue({ isFile: () => true });

    const absoluteImage = join(paths.workspace, "reports", "chart.png");
    const relativeImage = join(paths.workspace, "screens", "snap.jpg");
    mkdirSync(join(paths.workspace, "reports"), { recursive: true });
    mkdirSync(join(paths.workspace, "screens"), { recursive: true });
    writeFileSync(absoluteImage, "png-bytes");
    writeFileSync(relativeImage, "jpg-bytes");

    let onUpdate: ((update: { message?: unknown }) => Promise<void>) | undefined;
    createTelegramPollingMock.mockImplementation((_api, handler) => {
      onUpdate = handler;
      return { start() {}, async stop() {} };
    });

    const mainSessionAgent = {
      runPrompt: vi.fn(async () => ({
        text: `See ${absoluteImage} and ./screens/snap.jpg and /tmp/outside.png`,
        stopReason: "stop",
      })),
      bindSession: vi.fn(async () => {}),
      appendUserMessage: vi.fn(async () => {}),
      setBackgroundTaskLauncher: vi.fn(),
      stopActiveRun: vi.fn(() => false),
      getStatus: vi.fn(() => ({ provider: "openai", modelId: "gpt-test" })),
      dispose: vi.fn(async () => {}),
    };

    const { buildTelegramGatewayApp } = await import("../src/transports/telegram/app.js");
    const app = buildTelegramGatewayApp(runtime, mainSessionAgent as never);
    await app?.start();

    await onUpdate?.({
      message: {
        message_id: 4,
        chat: { id: 123, type: "private" },
        from: { id: 456, first_name: "User" },
        text: "show images",
      },
    });

    expect(sendPhotoMock).toHaveBeenCalledTimes(2);
    expect(sendPhotoMock).toHaveBeenNthCalledWith(1, "123", expect.any(Blob), "chart.png", "chart.png");
    expect(sendPhotoMock).toHaveBeenNthCalledWith(2, "123", expect.any(Blob), "snap.jpg", "snap.jpg");
  });

  it("sends an error message when the agent run fails", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const runtime = createRuntime(paths);
    resolveTelegramConversationBindingMock.mockResolvedValue({ sessionId: "session-1" });

    let onUpdate: ((update: { message?: unknown }) => Promise<void>) | undefined;
    createTelegramPollingMock.mockImplementation((_api, handler) => {
      onUpdate = handler;
      return { start() {}, async stop() {} };
    });

    const mainSessionAgent = {
      runPrompt: vi.fn(async () => {
        throw new Error("provider boom");
      }),
      bindSession: vi.fn(async () => {}),
      appendUserMessage: vi.fn(async () => {}),
      setBackgroundTaskLauncher: vi.fn(),
      stopActiveRun: vi.fn(() => false),
      getStatus: vi.fn(() => ({ provider: "openai", modelId: "gpt-test" })),
      dispose: vi.fn(async () => {}),
    };

    const { buildTelegramGatewayApp } = await import("../src/transports/telegram/app.js");
    const app = buildTelegramGatewayApp(runtime, mainSessionAgent as never);
    await app?.start();

    await onUpdate?.({
      message: {
        message_id: 5,
        chat: { id: 123, type: "private" },
        from: { id: 456, first_name: "User" },
        text: "hello",
      },
    });

    expect(sendMessageMock).toHaveBeenCalledWith("123", "Error: provider boom");
  });

  it("sends the model error message instead of Done when a run ends with stopReason=error", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const runtime = createRuntime(paths);
    resolveTelegramConversationBindingMock.mockResolvedValue({ sessionId: "session-1" });

    let onUpdate: ((update: { message?: unknown }) => Promise<void>) | undefined;
    createTelegramPollingMock.mockImplementation((_api, handler) => {
      onUpdate = handler;
      return { start() {}, async stop() {} };
    });

    const mainSessionAgent = {
      runPrompt: vi.fn(async () => ({ text: "", stopReason: "error", errorMessage: "401 token expired" })),
      bindSession: vi.fn(async () => {}),
      appendUserMessage: vi.fn(async () => {}),
      setBackgroundTaskLauncher: vi.fn(),
      stopActiveRun: vi.fn(() => false),
      getStatus: vi.fn(() => ({ provider: "openai", modelId: "gpt-test" })),
      dispose: vi.fn(async () => {}),
    };

    const { buildTelegramGatewayApp } = await import("../src/transports/telegram/app.js");
    const app = buildTelegramGatewayApp(runtime, mainSessionAgent as never);
    await app?.start();

    await onUpdate?.({
      message: {
        message_id: 6,
        chat: { id: 123, type: "private" },
        from: { id: 456, first_name: "User" },
        text: "hello",
      },
    });

    expect(sendMessageMock).toHaveBeenCalledWith("123", "401 token expired");
    expect(sendMessageMock).not.toHaveBeenCalledWith("123", "Done.");
  });

  it("keeps polling alive when Telegram command registration fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setMyCommandsMock.mockRejectedValueOnce(new Error("telegram down"));
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const runtime = createRuntime(paths);

    const pollingStart = vi.fn();
    createTelegramPollingMock.mockImplementation(() => ({ start: pollingStart, async stop() {} }));

    const mainSessionAgent = {
      runPrompt: vi.fn(async () => ({ text: "unused", stopReason: "stop" })),
      bindSession: vi.fn(async () => {}),
      appendUserMessage: vi.fn(async () => {}),
      setBackgroundTaskLauncher: vi.fn(),
      stopActiveRun: vi.fn(() => false),
      getStatus: vi.fn(() => ({ provider: "openai", modelId: "gpt-test" })),
      dispose: vi.fn(async () => {}),
    };

    const { buildTelegramGatewayApp } = await import("../src/transports/telegram/app.js");
    const app = buildTelegramGatewayApp(runtime, mainSessionAgent as never);
    await app?.start();

    expect(errorSpy).toHaveBeenCalledWith("Failed to register Telegram bot commands:", "telegram down");
    expect(pollingStart).toHaveBeenCalledTimes(1);
  });

  it("ignores edited_message updates so edits do not trigger duplicate runs", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const runtime = createRuntime(paths);
    resolveTelegramConversationBindingMock.mockResolvedValue({ sessionId: "session-1" });

    let onUpdate: ((update: { message?: unknown; edited_message?: unknown }) => Promise<void>) | undefined;
    createTelegramPollingMock.mockImplementation((_api, handler) => {
      onUpdate = handler;
      return {
        start() {},
        async stop() {},
      };
    });

    const mainSessionAgent = {
      runPrompt: vi.fn(async (_sessionId: string, prompt: string) => ({ text: `saw ${prompt}`, stopReason: "stop" })),
      bindSession: vi.fn(async () => {}),
      appendUserMessage: vi.fn(async () => {}),
      setBackgroundTaskLauncher: vi.fn(),
      stopActiveRun: vi.fn(() => false),
      getStatus: vi.fn(() => ({ provider: "openai", modelId: "gpt-test" })),
      dispose: vi.fn(async () => {}),
    };

    const { buildTelegramGatewayApp } = await import("../src/transports/telegram/app.js");
    const app = buildTelegramGatewayApp(runtime, mainSessionAgent as never);
    await app?.start();

    await onUpdate?.({
      edited_message: {
        message_id: 77,
        chat: { id: 123, type: "private" },
        from: { id: 456, first_name: "User" },
        caption: "what is in this image?",
        photo: [{ file_id: "file-photo", file_unique_id: "photo-unique", width: 100, height: 100 }],
      },
    });

    expect(getFileMock).not.toHaveBeenCalled();
    expect(mainSessionAgent.runPrompt).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});
