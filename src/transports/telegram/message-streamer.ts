import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { TelegramApiClient } from "./api.js";
import { chunkTelegramText } from "./formatter.js";

const TYPING_REFRESH_INTERVAL_MS = 4000;

function imageMimeTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

export class TelegramStreamingMessage {
  readonly #api: TelegramApiClient;
  readonly #chatId: string;
  #timer: NodeJS.Timeout | undefined;
  #closed = false;

  constructor(api: TelegramApiClient, chatId: string) {
    this.#api = api;
    this.#chatId = chatId;
  }

  append(delta: string): void {
    void delta;
    // Telegram has no native streaming-message primitive. While the agent is
    // running, keep the built-in typing indicator alive and send the final
    // answer as a normal message in finish().
  }

  start(): void {
    void this.#sendTyping();
    this.#timer = setInterval(() => {
      void this.#sendTyping();
    }, TYPING_REFRESH_INTERVAL_MS);
  }

  async finish(finalText: string): Promise<void> {
    this.#close();
    for (const chunk of chunkTelegramText(finalText || "Done.")) {
      await this.#api.sendMessage(this.#chatId, chunk);
    }
  }

  async fail(text: string): Promise<void> {
    this.#close();
    await this.#api.sendMessage(this.#chatId, text);
  }

  #close(): void {
    this.#closed = true;
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  async #sendTyping(): Promise<void> {
    if (this.#closed) return;
    try {
      await this.#api.sendChatAction(this.#chatId, "typing");
    } catch {
      // Typing indicators are best-effort; don't fail the agent response if
      // Telegram rejects or drops one chat action request.
    }
  }
}

export class TelegramMessageStreamer {
  readonly #api: TelegramApiClient;

  constructor(api: TelegramApiClient) {
    this.#api = api;
  }

  async sendText(chatId: string, text: string): Promise<void> {
    for (const chunk of chunkTelegramText(text)) {
      await this.#api.sendMessage(chatId, chunk);
    }
  }

  async sendImage(chatId: string, path: string, caption?: string): Promise<void> {
    const data = await readFile(path);
    const blob = new Blob([data], { type: imageMimeTypeForPath(path) });
    await this.#api.sendPhoto(chatId, blob, basename(path), caption);
  }

  async startStream(chatId: string): Promise<TelegramStreamingMessage> {
    const stream = new TelegramStreamingMessage(this.#api, chatId);
    stream.start();
    return stream;
  }
}
