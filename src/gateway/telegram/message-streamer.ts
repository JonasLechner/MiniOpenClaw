import { TelegramApiClient } from "./api.js";
import { chunkTelegramText } from "./formatter.js";

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
}
