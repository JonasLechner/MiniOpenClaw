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
