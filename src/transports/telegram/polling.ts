import type { TelegramUpdate } from "./api.js";
import { TelegramApiClient } from "./api.js";

export type TelegramPolling = {
  start(): void;
  stop(): Promise<void>;
};
export function createTelegramPolling(
  api: TelegramApiClient,
  onUpdate: (update: TelegramUpdate) => Promise<void>,
): TelegramPolling {
  let offset = 0;
  let stopped = false;
  let loopPromise: Promise<void> | undefined;
  let requestController: AbortController | undefined;

  async function loop(): Promise<void> {
    while (!stopped) {
      try {
        requestController = new AbortController();
        const updates = await api.getUpdates(offset, 30, requestController.signal);

        for (const update of updates) {
          offset = update.update_id + 1;
          await onUpdate(update);
        }
      } catch (error) {
        if (stopped && error instanceof Error && error.name === "AbortError") {
          break;
        }

        console.error("telegram polling failed:", error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } finally {
        requestController = undefined;
      }
    }
  }

  return {
    start() {
      if (loopPromise) return;
      stopped = false;
      loopPromise = loop();
    },
    async stop() {
      stopped = true;
      requestController?.abort();
      const activeLoop = loopPromise;
      loopPromise = undefined;
      await activeLoop;
    },
  };
}
