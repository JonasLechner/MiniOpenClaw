import { TelegramApiClient } from "./api.js";
import { chunkTelegramText } from "./formatter.js";

const STREAM_EDIT_INTERVAL_MS = 800;
const STREAM_PREVIEW_MAX_LENGTH = 3900;

function previewText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "Thinking…";
  if (trimmed.length <= STREAM_PREVIEW_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, STREAM_PREVIEW_MAX_LENGTH - 20).trimEnd()}\n…`;
}

export class TelegramStreamingMessage {
  readonly #api: TelegramApiClient;
  readonly #chatId: string;
  readonly #messageId: number;
  #text = "";
  #lastSent = "Thinking…";
  #editPromise: Promise<void> = Promise.resolve();
  #timer: NodeJS.Timeout | undefined;
  #closed = false;

  constructor(api: TelegramApiClient, chatId: string, messageId: number) {
    this.#api = api;
    this.#chatId = chatId;
    this.#messageId = messageId;
  }

  append(delta: string): void {
    if (this.#closed || !delta) return;
    this.#text += delta;
    this.#scheduleFlush();
  }

  async finish(finalText: string): Promise<void> {
    this.#closed = true;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }

    const chunks = chunkTelegramText(finalText);
    await this.#edit(chunks[0] ?? "Done.");

    for (const chunk of chunks.slice(1)) {
      await this.#api.sendMessage(this.#chatId, chunk);
    }
  }

  async fail(text: string): Promise<void> {
    this.#closed = true;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    this.#text = text;
    await this.#flush();
  }

  #scheduleFlush(): void {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#flush();
    }, STREAM_EDIT_INTERVAL_MS);
  }

  async #flush(): Promise<void> {
    return this.#edit(previewText(this.#text));
  }

  async #edit(text: string): Promise<void> {
    if (text === this.#lastSent) return this.#editPromise;

    this.#lastSent = text;
    this.#editPromise = this.#editPromise.then(async () => {
      await this.#api.editMessageText(this.#chatId, this.#messageId, text);
    });
    return this.#editPromise;
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

  async startStream(chatId: string): Promise<TelegramStreamingMessage> {
    const message = await this.#api.sendMessage(chatId, "Thinking…");
    return new TelegramStreamingMessage(this.#api, chatId, message.message_id);
  }
}
