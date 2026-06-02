export type TelegramUser = {
  id: number;
  username?: string;
  first_name?: string;
};

export type TelegramChat = {
  id: number;
  type: string;
};

export type TelegramPhotoSize = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
};

export type TelegramDocument = {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

export type TelegramAnimation = TelegramDocument;

export type TelegramVideo = {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  width?: number;
  height?: number;
  duration?: number;
};

export type TelegramLivePhoto = {
  photo: TelegramPhotoSize[];
};

export type TelegramMessage = {
  message_id: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  animation?: TelegramAnimation;
  video?: TelegramVideo;
  live_photo?: TelegramLivePhoto;
  chat: TelegramChat;
  from?: TelegramUser;
};

export type TelegramFile = {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

export type TelegramBotCommand = {
  command: string;
  description: string;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result: T;
  description?: string;
};

function assertTelegramApiResponse<T>(method: string, payload: TelegramApiResponse<T>): T {
  if (!payload.ok) {
    throw new Error(payload.description ?? `Telegram API ${method} failed.`);
  }

  return payload.result;
}

export class TelegramApiClient {
  readonly #baseUrl: string;

  constructor(token: string) {
    this.#baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async getUpdates(offset?: number, timeout = 30, signal?: AbortSignal): Promise<TelegramUpdate[]> {
    return this.#request<TelegramUpdate[]>("getUpdates", {
      offset,
      timeout,
      allowed_updates: ["message", "edited_message"],
    }, signal);
  }

  async sendMessage(chatId: string, text: string, signal?: AbortSignal): Promise<TelegramMessage> {
    return await this.#request<TelegramMessage>("sendMessage", {
      chat_id: chatId,
      text,
    }, signal);
  }

  async editMessageText(chatId: string, messageId: number, text: string, signal?: AbortSignal): Promise<TelegramMessage> {
    return await this.#request<TelegramMessage>("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
    }, signal);
  }

  async setMyCommands(commands: readonly TelegramBotCommand[], signal?: AbortSignal): Promise<boolean> {
    return await this.#request<boolean>("setMyCommands", { commands }, signal);
  }

  async sendPhoto(chatId: string, photo: Blob, filename: string, caption?: string, signal?: AbortSignal): Promise<TelegramMessage> {
    const body = new FormData();
    body.set("chat_id", chatId);
    body.set("photo", photo, filename);
    if (caption) body.set("caption", caption);

    const response = await fetch(`${this.#baseUrl}/sendPhoto`, {
      method: "POST",
      body,
      signal,
    });

    if (!response.ok) {
      throw new Error(`Telegram API sendPhoto failed with ${response.status}.`);
    }

    return assertTelegramApiResponse("sendPhoto", await response.json() as TelegramApiResponse<TelegramMessage>);
  }

  async getFile(fileId: string, signal?: AbortSignal): Promise<TelegramFile> {
    return await this.#request<TelegramFile>("getFile", { file_id: fileId }, signal);
  }

  async downloadFile(filePath: string, signal?: AbortSignal): Promise<Buffer> {
    const response = await fetch(`${this.#baseUrl.replace("/bot", "/file/bot")}/${filePath}`, { signal });
    if (!response.ok) {
      throw new Error(`Telegram file download failed with ${response.status}.`);
    }
    return Buffer.from(await response.arrayBuffer());
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

    return assertTelegramApiResponse(method, await response.json() as TelegramApiResponse<T>);
  }
}
