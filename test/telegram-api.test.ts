import { afterEach, describe, expect, it, vi } from "vitest";
import { TelegramApiClient, TelegramApiError } from "../src/transports/telegram/api.js";

describe("TelegramApiClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fails with method and HTTP status context before JSON parsing in #request", async () => {
    const json = vi.fn(async () => {
      throw new Error("should not parse");
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 502,
      json,
    })));

    const client = new TelegramApiClient("token");

    await expect(client.sendMessage("chat-1", "hello")).rejects.toMatchObject({
      name: "TelegramApiError",
      method: "sendMessage",
      httpStatus: 502,
      description: "Telegram API sendMessage failed with HTTP 502.",
    } satisfies Partial<TelegramApiError>);
    expect(json).not.toHaveBeenCalled();
  });

  it("fails with method and HTTP status context before JSON parsing in sendPhoto", async () => {
    const json = vi.fn(async () => {
      throw new Error("should not parse");
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 503,
      json,
    })));

    const client = new TelegramApiClient("token");

    await expect(client.sendPhoto("chat-1", new Blob(["x"]), "x.txt")).rejects.toMatchObject({
      name: "TelegramApiError",
      method: "sendPhoto",
      httpStatus: 503,
      description: "Telegram API sendPhoto failed with HTTP 503.",
    } satisfies Partial<TelegramApiError>);
    expect(json).not.toHaveBeenCalled();
  });
});
