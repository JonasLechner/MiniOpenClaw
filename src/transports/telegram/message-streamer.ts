import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { createLogger } from "../../core/log.js";
import { TelegramApiClient, TelegramApiError } from "./api.js";
import { chunkTelegramText, formatTelegramMarkdownV2 } from "./formatter.js";

const TYPING_REFRESH_INTERVAL_MS = 4000;
const STREAM_FLUSH_INTERVAL_MS = 500;

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

function isTelegramMessageNotModifiedError(error: unknown): boolean {
  return error instanceof TelegramApiError && error.reason === "message_not_modified";
}

export class TelegramStreamingMessage {
  readonly #api: TelegramApiClient;
  readonly #chatId: string;
  #timer: NodeJS.Timeout | undefined;
  #flushTimer: NodeJS.Timeout | undefined;
  #closed = false;
  #pendingText = "";
  #messageIds: number[] = [];
  #renderedChunks: string[] = [];
  #mutationLane = Promise.resolve();
  #immediateFlushQueued = false;
  #streamError: Error | undefined;

  constructor(api: TelegramApiClient, chatId: string) {
    this.#api = api;
    this.#chatId = chatId;
  }

  append(delta: string): void {
    if (this.#closed || this.#streamError || !delta) return;
    this.#pendingText += delta;
    if (this.#messageIds.length === 0) {
      this.#scheduleImmediateFlush();
      return;
    }
    this.#scheduleDeferredFlush();
  }

  start(): void {
    void this.#sendTyping();
    this.#timer = setInterval(() => {
      void this.#sendTyping();
    }, TYPING_REFRESH_INTERVAL_MS);
  }

  async finish(finalText: string): Promise<void> {
    this.#pendingText = finalText || "Done.";
    this.#close();
    if (this.#streamError) {
      throw this.#streamError;
    }
    await this.#enqueueMutation(async () => {
      await this.#syncToText(this.#pendingText);
    });
  }

  async fail(text: string): Promise<void> {
    this.#close();
    const chunks = chunkTelegramText(text);
    await this.#enqueueMutation(async () => {
      for (const chunk of chunks) {
        await this.#api.sendMessage(this.#chatId, chunk);
      }
    });
  }

  #close(): void {
    this.#closed = true;
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = undefined;
    }
  }

  #scheduleImmediateFlush(): void {
    if (this.#immediateFlushQueued) return;
    this.#immediateFlushQueued = true;
    queueMicrotask(() => {
      this.#immediateFlushQueued = false;
      if (this.#closed) return;
      void this.#flushIncremental();
    });
  }

  #scheduleDeferredFlush(): void {
    if (this.#flushTimer) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = undefined;
      if (this.#closed) return;
      void this.#flushIncremental();
    }, STREAM_FLUSH_INTERVAL_MS);
  }

  async #flushIncremental(): Promise<void> {
    if (this.#streamError) return;

    const snapshot = this.#pendingText;
    try {
      await this.#enqueueMutation(async () => {
        await this.#syncToText(snapshot);
      });
    } catch (error) {
      this.#streamError = error instanceof Error ? error : new Error(String(error));
      this.#close();
      return;
    }

    if (!this.#closed && this.#pendingText !== snapshot) {
      if (this.#messageIds.length === 0) {
        this.#scheduleImmediateFlush();
      } else {
        this.#scheduleDeferredFlush();
      }
    }
  }

  #enqueueMutation(task: () => Promise<void>): Promise<void> {
    const next = this.#mutationLane.catch(() => undefined).then(task);
    this.#mutationLane = next.then(() => undefined, () => undefined);
    return next;
  }

  async #syncToText(text: string): Promise<void> {
    const chunks = chunkTelegramText(text || "Done.");

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index]!;
      const messageId = this.#messageIds[index];
      const rendered = this.#renderedChunks[index];

      if (messageId === undefined) {
        const message = await this.#api.sendMessage(this.#chatId, chunk);
        this.#messageIds[index] = message.message_id;
        this.#renderedChunks[index] = chunk;
        continue;
      }

      if (rendered === chunk) {
        continue;
      }

      try {
        const message = await this.#api.editMessageText(this.#chatId, messageId, chunk);
        this.#messageIds[index] = message.message_id;
        this.#renderedChunks[index] = chunk;
      } catch (error) {
        if (isTelegramMessageNotModifiedError(error)) {
          this.#renderedChunks[index] = chunk;
          continue;
        }

        throw error;
      }
    }

    if (this.#messageIds.length > chunks.length) {
      const retainedMessageIds = this.#messageIds.slice(0, chunks.length);
      const retainedRenderedChunks = this.#renderedChunks.slice(0, chunks.length);

      for (let index = chunks.length; index < this.#messageIds.length; index += 1) {
        const messageId = this.#messageIds[index];
        const renderedChunk = this.#renderedChunks[index];
        if (messageId === undefined) continue;

        try {
          await this.#api.deleteMessage(this.#chatId, messageId);
        } catch (error) {
          retainedMessageIds.push(messageId);
          retainedRenderedChunks.push(renderedChunk ?? "");
          this.#messageIds = retainedMessageIds;
          this.#renderedChunks = retainedRenderedChunks;
          throw error;
        }
      }

      this.#messageIds = retainedMessageIds;
      this.#renderedChunks = retainedRenderedChunks;
      return;
    }

    this.#messageIds.length = chunks.length;
    this.#renderedChunks.length = chunks.length;
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
  readonly #logger = createLogger({ component: "telegram" });

  constructor(api: TelegramApiClient) {
    this.#api = api;
  }

  async sendText(chatId: string, text: string): Promise<void> {
    for (const chunk of chunkTelegramText(text)) {
      await this.#api.sendMessage(chatId, chunk);
    }
    this.#logger.info("telegram_message_sent", { chatId, text });
  }

  async sendImage(chatId: string, path: string, caption?: string): Promise<void> {
    const data = await readFile(path);
    const blob = new Blob([data], { type: imageMimeTypeForPath(path) });
    await this.#api.sendPhoto(chatId, blob, basename(path), caption ? formatTelegramMarkdownV2(caption) : undefined);
    this.#logger.info("telegram_image_sent", { chatId, path, caption });
  }

  async startStream(chatId: string): Promise<TelegramStreamingMessage> {
    const stream = new TelegramStreamingMessage(this.#api, chatId);
    stream.start();
    return stream;
  }
}
