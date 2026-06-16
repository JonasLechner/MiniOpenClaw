import { afterEach, describe, expect, it, vi } from "vitest";
import { TelegramApiClient } from "../src/transports/telegram/api.js";

describe("TelegramApiClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails loudly on invalid JSON instead of normalizing it into a Telegram API error", async () => {
    const parseError = new SyntaxError("Unexpected token < in JSON");
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => { throw parseError; },
    } as unknown as Response);

    const api = new TelegramApiClient("token");

    await expect(api.sendMessage("chat-1", "hello")).rejects.toMatchObject({
      name: "Error",
      message: "Telegram API sendMessage returned invalid JSON (HTTP 502).",
      cause: parseError,
    });
  });

  it("sends MarkdownV2 parse mode for text messages", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: { message_id: 1, chat: { id: 1, type: "private" } },
      }),
    } as unknown as Response);

    const api = new TelegramApiClient("token");
    await api.sendMessage("chat-1", "hello");

    expect(fetchMock).toHaveBeenCalledWith("https://api.telegram.org/bottoken/sendMessage", expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: "chat-1",
        text: "hello",
        parse_mode: "MarkdownV2",
      }),
    }));
  });

  it("classifies message-not-modified from Telegram's JSON error payload even on HTTP 400", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        ok: false,
        error_code: 400,
        description: "Bad Request: message is not modified",
      }),
    } as unknown as Response);

    const api = new TelegramApiClient("token");

    await expect(api.editMessageText("chat-1", 1, "hello")).rejects.toMatchObject({
      name: "TelegramApiError",
      method: "editMessageText",
      httpStatus: 400,
      errorCode: 400,
      reason: "message_not_modified",
    });
  });

  it("sends MarkdownV2 parse mode for photo captions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: { message_id: 1, chat: { id: 1, type: "private" } },
      }),
    } as unknown as Response);

    const api = new TelegramApiClient("token");
    await api.sendPhoto("chat-1", new Blob(["x"], { type: "image/png" }), "x.png", "**cap**");

    const [, request] = fetchMock.mock.calls[0] ?? [];
    expect(request).toMatchObject({ method: "POST" });
    expect(request?.body).toBeInstanceOf(FormData);
    const body = request?.body as FormData;
    expect(body.get("caption")).toBe("**cap**");
    expect(body.get("parse_mode")).toBe("MarkdownV2");
  });
});
