import { afterEach, describe, expect, it, vi } from "vitest";
import type { TelegramUpdate } from "../src/transports/telegram/api.js";
import { createTelegramPolling } from "../src/transports/telegram/polling.js";

const pendingRequests = new Set<(reason?: unknown) => void>();

const getUpdatesMock = vi.fn(async (_offset?: number, _timeout?: number, signal?: AbortSignal): Promise<TelegramUpdate[]> => {
  return new Promise<TelegramUpdate[]>((_resolve, reject) => {
    const abort = () => {
      pendingRequests.delete(abort);
      reject(new DOMException("Aborted", "AbortError"));
    };

    pendingRequests.add(abort);
    signal?.addEventListener("abort", abort, { once: true });
  });
});

afterEach(() => {
  pendingRequests.clear();
  vi.clearAllMocks();
});

describe("telegram polling", () => {
  it("does not block polling on a long-running update handler", async () => {
    const never = new Promise<void>(() => {});
    const getUpdates = vi
      .fn<(_offset?: number, _timeout?: number, signal?: AbortSignal) => Promise<TelegramUpdate[]>>()
      .mockResolvedValueOnce([
        { update_id: 1, message: { message_id: 1, chat: { id: 1, type: "private" }, from: { id: 1, first_name: "A" }, text: "slow" } },
        { update_id: 2, message: { message_id: 2, chat: { id: 1, type: "private" }, from: { id: 1, first_name: "A" }, text: "/stop" } },
      ] as TelegramUpdate[])
      .mockImplementation((_offset, _timeout, signal) => new Promise<TelegramUpdate[]>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }));
    const onUpdate = vi.fn(async (update: TelegramUpdate) => {
      if (update.update_id === 1) {
        await never;
      }
    });
    const polling = createTelegramPolling({ getUpdates } as never, onUpdate);

    polling.start();
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    await polling.stop();
  });

  it("aborts the in-flight long poll on stop", async () => {
    const polling = createTelegramPolling(
      { getUpdates: getUpdatesMock } as never,
      async () => {},
    );

    polling.start();
    await vi.waitFor(() => expect(getUpdatesMock).toHaveBeenCalledTimes(1));

    await expect(polling.stop()).resolves.toBeUndefined();
  });
});
