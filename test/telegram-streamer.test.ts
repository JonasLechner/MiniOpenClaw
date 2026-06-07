import { describe, expect, it, vi } from "vitest";
import { TelegramApiError } from "../src/transports/telegram/api.js";
import { TelegramMessageStreamer } from "../src/transports/telegram/message-streamer.js";

describe("TelegramMessageStreamer", () => {
  it("streams visible Telegram message edits while keeping typing alive", async () => {
    vi.useFakeTimers();
    let nextMessageId = 0;
    const sendMessage = vi.fn(async (_chatId: string, text: string) => ({
      message_id: ++nextMessageId,
      text,
      chat: { id: 1, type: "private" },
    }));
    const editMessageText = vi.fn(async (_chatId: string, messageId: number, text: string) => ({
      message_id: messageId,
      text,
      chat: { id: 1, type: "private" },
    }));
    const deleteMessage = vi.fn(async () => true);
    const sendChatAction = vi.fn(async () => true);
    const streamer = new TelegramMessageStreamer({ sendMessage, editMessageText, deleteMessage, sendChatAction } as never);

    const stream = await streamer.startStream("chat-1");
    stream.append("Hel");
    stream.append("lo");
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith("chat-1", "Hello"));

    expect(sendChatAction).toHaveBeenCalledWith("chat-1", "typing");
    expect(editMessageText).not.toHaveBeenCalled();

    stream.append(" world");
    await vi.advanceTimersByTimeAsync(500);
    expect(editMessageText).toHaveBeenCalledWith("chat-1", 1, "Hello world");

    await vi.advanceTimersByTimeAsync(4000);
    expect(sendChatAction).toHaveBeenCalledTimes(2);

    await stream.finish("Hello world!");
    expect(editMessageText).toHaveBeenCalledWith("chat-1", 1, "Hello world\\!");
    expect(deleteMessage).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("creates additional streamed messages when the text grows past Telegram limits", async () => {
    vi.useFakeTimers();
    let nextMessageId = 0;
    const sendMessage = vi.fn(async (_chatId: string, text: string) => ({
      message_id: ++nextMessageId,
      text,
      chat: { id: 1, type: "private" },
    }));
    const editMessageText = vi.fn(async (_chatId: string, messageId: number, text: string) => ({
      message_id: messageId,
      text,
      chat: { id: 1, type: "private" },
    }));
    const deleteMessage = vi.fn(async () => true);
    const sendChatAction = vi.fn(async () => true);
    const streamer = new TelegramMessageStreamer({ sendMessage, editMessageText, deleteMessage, sendChatAction } as never);

    const stream = await streamer.startStream("chat-1");
    stream.append("x".repeat(4000));
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage).toHaveBeenLastCalledWith("chat-1", "x".repeat(4000));

    stream.append("yz");
    await vi.advanceTimersByTimeAsync(500);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(2, "chat-1", "yz");
    expect(editMessageText).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("cleans up extra streamed messages when the final text becomes shorter", async () => {
    vi.useFakeTimers();
    let nextMessageId = 0;
    const sendMessage = vi.fn(async (_chatId: string, text: string) => ({
      message_id: ++nextMessageId,
      text,
      chat: { id: 1, type: "private" },
    }));
    const editMessageText = vi.fn(async (_chatId: string, messageId: number, text: string) => ({
      message_id: messageId,
      text,
      chat: { id: 1, type: "private" },
    }));
    const deleteMessage = vi.fn(async () => true);
    const sendChatAction = vi.fn(async () => true);
    const streamer = new TelegramMessageStreamer({ sendMessage, editMessageText, deleteMessage, sendChatAction } as never);

    const stream = await streamer.startStream("chat-1");
    stream.append("x".repeat(4001));
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));

    expect(sendMessage).toHaveBeenNthCalledWith(1, "chat-1", "x".repeat(4000));
    expect(sendMessage).toHaveBeenNthCalledWith(2, "chat-1", "x");

    await stream.finish("Stopped.");

    expect(editMessageText).toHaveBeenCalledWith("chat-1", 1, "Stopped\\.");
    expect(deleteMessage).toHaveBeenCalledWith("chat-1", 2);
    vi.useRealTimers();
  });

  it("treats Telegram message-not-modified as a no-op via stable API error metadata", async () => {
    vi.useFakeTimers();
    const sendMessage = vi.fn(async () => ({ message_id: 1, chat: { id: 1, type: "private" } }));
    const editMessageText = vi.fn(async () => {
      throw new TelegramApiError("editMessageText", {
        errorCode: 400,
        description: "Bad Request: message is not modified",
        reason: "message_not_modified",
      });
    });
    const deleteMessage = vi.fn(async () => true);
    const sendChatAction = vi.fn(async () => true);
    const streamer = new TelegramMessageStreamer({ sendMessage, editMessageText, deleteMessage, sendChatAction } as never);

    const stream = await streamer.startStream("chat-1");
    stream.append("Hello");
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith("chat-1", "Hello"));

    stream.append(" world");
    await vi.advanceTimersByTimeAsync(500);
    await stream.finish("Hello world");

    expect(editMessageText).toHaveBeenCalledWith("chat-1", 1, "Hello world");
    expect(sendMessage).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("fails fast on edit errors without replacing the original streamed message", async () => {
    vi.useFakeTimers();
    const sendMessage = vi.fn(async () => ({ message_id: 1, chat: { id: 1, type: "private" } }));
    const editMessageText = vi.fn(async () => {
      throw new TelegramApiError("editMessageText", { errorCode: 500, description: "Internal Server Error" });
    });
    const deleteMessage = vi.fn(async () => true);
    const sendChatAction = vi.fn(async () => true);
    const streamer = new TelegramMessageStreamer({ sendMessage, editMessageText, deleteMessage, sendChatAction } as never);

    const stream = await streamer.startStream("chat-1");
    stream.append("Hello");
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    stream.append(" world");
    await vi.advanceTimersByTimeAsync(500);

    await expect(stream.finish("Hello world")).rejects.toThrow("Internal Server Error");
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(deleteMessage).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("preserves only not-yet-deleted extra chunk ids when cleanup partially fails", async () => {
    vi.useFakeTimers();
    let nextMessageId = 0;
    const sendMessage = vi.fn(async (_chatId: string, text: string) => ({
      message_id: ++nextMessageId,
      text,
      chat: { id: 1, type: "private" },
    }));
    const editMessageText = vi.fn(async (_chatId: string, messageId: number, text: string) => ({
      message_id: messageId,
      text,
      chat: { id: 1, type: "private" },
    }));
    const deleteMessage = vi.fn(async (_chatId: string, messageId: number) => {
      if (messageId === 3 && deleteMessage.mock.calls.length === 2) {
        throw new TelegramApiError("deleteMessage", { errorCode: 500, description: "cleanup failed" });
      }
      return true;
    });
    const sendChatAction = vi.fn(async () => true);
    const streamer = new TelegramMessageStreamer({ sendMessage, editMessageText, deleteMessage, sendChatAction } as never);

    const stream = await streamer.startStream("chat-1");
    stream.append("x".repeat(8001));
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(3));

    await expect(stream.finish("Stopped.")).rejects.toThrow("cleanup failed");
    expect(deleteMessage.mock.calls).toEqual([
      ["chat-1", 2],
      ["chat-1", 3],
    ]);

    await expect(stream.finish("Stopped.")).resolves.toBeUndefined();
    expect(deleteMessage.mock.calls).toEqual([
      ["chat-1", 2],
      ["chat-1", 3],
      ["chat-1", 3],
    ]);
    vi.useRealTimers();
  });

  it("falls back cleanly when typing actions fail and stops sending them after fail", async () => {
    vi.useFakeTimers();
    const sendMessage = vi.fn(async () => ({ message_id: 1, chat: { id: 1, type: "private" } }));
    const editMessageText = vi.fn(async () => ({ message_id: 1, chat: { id: 1, type: "private" } }));
    const deleteMessage = vi.fn(async () => true);
    const sendChatAction = vi.fn(async () => {
      throw new Error("telegram temporary error");
    });
    const streamer = new TelegramMessageStreamer({ sendMessage, editMessageText, deleteMessage, sendChatAction } as never);

    const stream = await streamer.startStream("chat-1");
    await Promise.resolve();
    expect(sendChatAction).toHaveBeenCalledWith("chat-1", "typing");

    await stream.fail("Error: boom");
    expect(sendMessage).toHaveBeenCalledWith("chat-1", "Error: boom");

    await vi.advanceTimersByTimeAsync(8000);
    expect(sendChatAction).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("sends Done. when finish receives an empty final text", async () => {
    const sendMessage = vi.fn(async () => ({ message_id: 1, chat: { id: 1, type: "private" } }));
    const editMessageText = vi.fn(async () => ({ message_id: 1, chat: { id: 1, type: "private" } }));
    const deleteMessage = vi.fn(async () => true);
    const sendChatAction = vi.fn(async () => true);
    const streamer = new TelegramMessageStreamer({ sendMessage, editMessageText, deleteMessage, sendChatAction } as never);

    const stream = await streamer.startStream("chat-1");
    await stream.finish("");

    expect(sendMessage).toHaveBeenCalledWith("chat-1", "Done\\.");
  });
});
