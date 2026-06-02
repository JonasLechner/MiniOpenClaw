import { describe, expect, it, vi } from "vitest";
import { TelegramMessageStreamer } from "../src/transports/telegram/message-streamer.js";

describe("TelegramMessageStreamer", () => {
  it("edits the placeholder with streamed content and sends overflow chunks on finish", async () => {
    vi.useFakeTimers();
    const sendMessage = vi.fn(async (chatId: string, text: string) => {
      void chatId;
      void text;
      return {
        message_id: sendMessage.mock.calls.length,
        chat: { id: 1, type: "private" },
      };
    });
    const editMessageText = vi.fn(async (_chatId: string, messageId: number, text: string) => ({
      message_id: messageId,
      text,
      chat: { id: 1, type: "private" },
    }));
    const streamer = new TelegramMessageStreamer({ sendMessage, editMessageText } as never);

    const stream = await streamer.startStream("chat-1");
    stream.append("Hel");
    stream.append("lo");
    await vi.advanceTimersByTimeAsync(800);
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith("chat-1", "Thinking…");
    expect(editMessageText).toHaveBeenCalledWith("chat-1", 1, "Hello");

    await stream.finish(`${"x".repeat(4001)}\nfinal`);

    expect(editMessageText).toHaveBeenLastCalledWith("chat-1", 1, "x".repeat(4000));
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1]?.[0]).toBe("chat-1");
    expect(sendMessage.mock.calls[1]?.[1]).toContain("final");
    vi.useRealTimers();
  });
});
