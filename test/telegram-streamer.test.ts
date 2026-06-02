import { describe, expect, it, vi } from "vitest";
import { TelegramMessageStreamer } from "../src/transports/telegram/message-streamer.js";

describe("TelegramMessageStreamer", () => {
  it("uses Telegram typing actions while running and sends final chunks on finish", async () => {
    vi.useFakeTimers();
    const sendMessage = vi.fn(async (chatId: string, text: string) => {
      void chatId;
      void text;
      return {
        message_id: sendMessage.mock.calls.length,
        chat: { id: 1, type: "private" },
      };
    });
    const sendChatAction = vi.fn(async () => true);
    const streamer = new TelegramMessageStreamer({ sendMessage, sendChatAction } as never);

    const stream = await streamer.startStream("chat-1");
    stream.append("Hel");
    stream.append("lo");
    await Promise.resolve();

    expect(sendChatAction).toHaveBeenCalledWith("chat-1", "typing");
    expect(sendMessage).not.toHaveBeenCalledWith("chat-1", "Thinking…");

    await vi.advanceTimersByTimeAsync(4000);
    expect(sendChatAction).toHaveBeenCalledTimes(2);

    await stream.finish(`${"x".repeat(4001)}\nfinal`);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0]?.[0]).toBe("chat-1");
    expect(sendMessage.mock.calls[0]?.[1]).toBe("x".repeat(4000));
    expect(sendMessage.mock.calls[1]?.[1]).toContain("final");
    vi.useRealTimers();
  });
});
