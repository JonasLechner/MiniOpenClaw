import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimePaths } from "../src/core/config.js";
import type { RuntimeState } from "../src/core/runtime.js";

const resolveTelegramConversationBindingMock = vi.fn();
const logConversationMessageMock = vi.fn();
const handleTelegramCommandMock = vi.fn(async () => ({ handled: false }));
const createTelegramPollingMock = vi.fn();
const setMyCommandsMock = vi.fn(async () => true);
const getFileMock = vi.fn(async () => ({ file_unique_id: "unique-file", file_path: "photos/file.jpg" }));
const downloadFileMock = vi.fn(async () => Buffer.from("image-bytes"));
const sendMessageMock = vi.fn(async () => ({ message_id: 1, chat: { id: 1, type: "private" } }));
const editMessageTextMock = vi.fn(async (_chatId: string, messageId: number, text: string) => ({ message_id: messageId, text, chat: { id: 1, type: "private" } }));
const sendPhotoMock = vi.fn(async () => ({ message_id: 2, chat: { id: 1, type: "private" } }));

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

vi.mock("../src/transports/telegram/api.js", () => ({
  TelegramApiClient: class {
    setMyCommands = setMyCommandsMock;
    getFile = getFileMock;
    downloadFile = downloadFileMock;
    sendMessage = sendMessageMock;
    editMessageText = editMessageTextMock;
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

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
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

    expect(sendMessageMock).toHaveBeenCalledWith("123", "Thinking…");
    expect(editMessageTextMock).toHaveBeenCalledWith("123", 1, expect.stringContaining("saw User sent an image."));
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
