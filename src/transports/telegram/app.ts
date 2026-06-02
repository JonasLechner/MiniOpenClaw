import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { resolveTelegramConversationBinding } from "../../core/conversation-bindings.js";
import type { RuntimeState } from "../../core/runtime.js";
import type { MainSessionAgent } from "../../gateway/agent-runner.js";
import { createBackgroundTaskLauncher } from "../../jobs/background.js";
import { logConversationMessage } from "../../gateway/conversation-log.js";
import { handleTelegramCommand, TELEGRAM_BOT_COMMANDS } from "./commands.js";
import { TelegramApiClient } from "./api.js";
import { TelegramMessageStreamer } from "./message-streamer.js";
import { createTelegramPolling, type TelegramPolling } from "./polling.js";

export type TelegramGatewayApp = {
  streamer: TelegramMessageStreamer;
  start(): Promise<void>;
  stop(): Promise<void>;
};
function createPromptQueue() {
  const queues = new Map<string, Promise<void>>();

  return async function enqueue(key: string, task: () => Promise<void>): Promise<void> {
    const previous = queues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    queues.set(key, current.finally(() => {
      if (queues.get(key) === current) {
        queues.delete(key);
      }
    }));
    await current;
  };
}

function isAllowedUser(runtime: RuntimeState, userId: number): boolean {
  const allowed = runtime.config.gateway.telegram.allowedUserIds;
  return allowed.length === 0 || allowed.includes(String(userId));
}

export function buildTelegramGatewayApp(
  runtime: RuntimeState,
  mainSessionAgent: MainSessionAgent,
): TelegramGatewayApp | undefined {
  const telegramConfig = runtime.config.gateway.telegram;
  if (!telegramConfig.enabled || !telegramConfig.token || !telegramConfig.polling) {
    return undefined;
  }

  const api = new TelegramApiClient(telegramConfig.token);
  const streamer = new TelegramMessageStreamer(api);
  const enqueue = createPromptQueue();
  const backgroundTaskLauncher = createBackgroundTaskLauncher(runtime, streamer, mainSessionAgent);
  mainSessionAgent.setBackgroundTaskLauncher(backgroundTaskLauncher);

  function extensionFromMimeType(mimeType?: string): string {
    switch (mimeType) {
      case "image/jpeg": return ".jpg";
      case "image/png": return ".png";
      case "image/gif": return ".gif";
      case "image/webp": return ".webp";
      default: return "";
    }
  }

  function isImageDocument(document: NonNullable<NonNullable<Parameters<Parameters<typeof createTelegramPolling>[1]>[0]["message"]>["document"]> | undefined): boolean {
    if (!document) return false;
    if (document.mime_type?.startsWith("image/")) return true;

    const extension = extname(document.file_name ?? "").toLowerCase();
    return [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(extension);
  }

  async function saveTelegramImage(message: NonNullable<Parameters<Parameters<typeof createTelegramPolling>[1]>[0]["message"]>): Promise<string | undefined> {
    const photo = message.photo?.at(-1) ?? message.live_photo?.photo?.at(-1);
    const document = isImageDocument(message.document) ? message.document : undefined;
    const animation = isImageDocument(message.animation) ? message.animation : undefined;
    const video = message.video?.mime_type?.startsWith("image/") ? message.video : undefined;
    const fileId = photo?.file_id ?? document?.file_id ?? animation?.file_id ?? video?.file_id;
    if (!fileId) return undefined;

    const file = await api.getFile(fileId);
    if (!file.file_path) throw new Error("Telegram did not return a file path for the image.");

    const data = await api.downloadFile(file.file_path);
    const rawName = document?.file_name
      ? basename(document.file_name)
      : animation?.file_name
        ? basename(animation.file_name)
        : video?.file_name
          ? basename(video.file_name)
          : basename(file.file_path);
    const extension = extname(rawName) || extensionFromMimeType(document?.mime_type ?? animation?.mime_type ?? video?.mime_type) || ".img";
    const attachmentDir = join(runtime.paths.workspace, "telegram-attachments", String(message.chat.id));
    await mkdir(attachmentDir, { recursive: true });
    const localPath = join(attachmentDir, `${message.message_id}-${file.file_unique_id}${extension}`);
    await writeFile(localPath, data);
    return localPath;
  }

  function extractReferencedWorkspaceImages(text: string): string[] {
    const imagePathPattern = /(?:^|[\s`'"(])((?:\/[^\s`'"()]+|\.\.?\/[^\s`'"()]+)[^\s`'"()]*(?:\.png|\.jpe?g|\.gif|\.webp))(?:$|[\s`'"),.])/gim;
    const paths = new Set<string>();

    for (const match of text.matchAll(imagePathPattern)) {
      const rawPath = match[1];
      if (!rawPath) continue;
      const absolutePath = isAbsolute(rawPath) ? resolve(rawPath) : resolve(runtime.paths.workspace, rawPath);
      const workspaceRoot = resolve(runtime.paths.workspace);
      if (absolutePath === workspaceRoot || !absolutePath.startsWith(`${workspaceRoot}/`)) continue;
      paths.add(absolutePath);
    }

    return [...paths].slice(0, 5);
  }

  async function sendReferencedWorkspaceImages(chatId: string, text: string): Promise<void> {
    for (const imagePath of extractReferencedWorkspaceImages(text)) {
      try {
        const stats = await stat(imagePath);
        if (!stats.isFile()) continue;
        await streamer.sendImage(chatId, imagePath, basename(imagePath));
      } catch (error) {
        console.error("Failed to send Telegram image attachment:", error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function handleTextMessage(chatId: string, userId: string, text: string): Promise<void> {
    const binding = await resolveTelegramConversationBinding(runtime.paths, chatId, userId);
    const commandResult = await handleTelegramCommand(text, {
      runtime,
      binding,
      streamer,
      stopActiveRun: () => mainSessionAgent.stopActiveRun(),
      getStatus: () => mainSessionAgent.getStatus(),
      backgroundTaskLauncher,
    });
    if (commandResult.handled) {
      if (commandResult.sessionId) {
        await mainSessionAgent.bindSession(commandResult.sessionId);
      }
      return;
    }

    logConversationMessage({
      role: "user",
      source: "telegram",
      chatId,
      userId,
      text,
    });

    const stream = await streamer.startStream(chatId);
    try {
      const result = await mainSessionAgent.runPrompt(binding.sessionId, text, {
        source: "telegram",
        chatId,
        userId,
      }, {
        onEvent(event) {
          if (event.type === "message_delta") {
            stream.append(event.delta);
          }
        },
      });
      logConversationMessage({
        role: "assistant",
        source: "telegram",
        chatId,
        userId,
        stopReason: result.stopReason,
        text: result.text || "Done.",
      });
      const finalText = result.text || "Done.";
      await stream.finish(finalText);
      await sendReferencedWorkspaceImages(chatId, finalText);
    } catch (error) {
      const message = error instanceof Error ? `Error: ${error.message}` : `Error: ${String(error)}`;
      await stream.fail(message);
    }
  }

  const polling: TelegramPolling = createTelegramPolling(api, async (update) => {
    if (update.edited_message) return;

    const message = update.message;
    if (!message || message.chat.type !== "private" || !message.from) return;

    if (!isAllowedUser(runtime, message.from.id)) {
      await streamer.sendText(String(message.chat.id), "Unauthorized Telegram user.");
      return;
    }

    const chatId = String(message.chat.id);
    const userId = String(message.from.id);
    const imagePath = await saveTelegramImage(message);

    const text = imagePath
      ? [
        message.caption || message.text || "User sent an image.",
        "",
        `Image saved in the workspace at: ${imagePath}`,
        "Use the read tool on this path to inspect the image.",
      ].join("\n")
      : message.text;
    if (!text) return;

    if (text.trim().split(/\s+/)[0]?.split("@")[0] === "/stop") {
      try {
        await handleTextMessage(chatId, userId, text);
      } catch (error) {
        await streamer.sendText(
          chatId,
          error instanceof Error ? `Error: ${error.message}` : `Error: ${String(error)}`,
        );
      }
      return;
    }

    await enqueue(chatId, async () => {
      try {
        await handleTextMessage(chatId, userId, text);
      } catch (error) {
        await streamer.sendText(
          chatId,
          error instanceof Error ? `Error: ${error.message}` : `Error: ${String(error)}`,
        );
      }
    });
  });

  return {
    streamer,
    async start() {
      try {
        await api.setMyCommands(TELEGRAM_BOT_COMMANDS);
        console.log("Registered Telegram bot commands:", TELEGRAM_BOT_COMMANDS.map(({ command }) => `/${command}`).join(", "));
      } catch (error) {
        console.error("Failed to register Telegram bot commands:", error instanceof Error ? error.message : String(error));
      }
      polling?.start();
    },
    async stop() {
      mainSessionAgent.setBackgroundTaskLauncher(undefined);
      await polling.stop();
      await mainSessionAgent.dispose();
    },
  };
}
