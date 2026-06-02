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
});
