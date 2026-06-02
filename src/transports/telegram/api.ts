export type TelegramUser = {
  id: number;
  username?: string;
  first_name?: string;
};

export type TelegramChat = {
  id: number;
  type: string;
};

export type TelegramMessage = {
  message_id: number;
  text?: string;
  chat: TelegramChat;
  from?: TelegramUser;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result: T;
  description?: string;
};

export class TelegramApiClient {
  readonly #baseUrl: string;

  constructor(token: string) {
    this.#baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async getUpdates(offset?: number, timeout = 30, signal?: AbortSignal): Promise<TelegramUpdate[]> {
    return this.#request<TelegramUpdate[]>("getUpdates", {
      offset,
      timeout,
      allowed_updates: ["message"],
    }, signal);
  }

  async sendMessage(chatId: string, text: string, signal?: AbortSignal): Promise<void> {
    await this.#request("sendMessage", {
      chat_id: chatId,
      text,
    }, signal);
  }

  async #request<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${this.#baseUrl}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Telegram API ${method} failed with ${response.status}.`);
    }

    const payload = await response.json() as TelegramApiResponse<T>;
    if (!payload.ok) {
      throw new Error(payload.description ?? `Telegram API ${method} failed.`);
    }

    return payload.result;
  }
}
