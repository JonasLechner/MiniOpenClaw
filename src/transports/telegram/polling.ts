import { createLogger } from "../../core/log.js";
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
  const logger = createLogger({ component: "telegram" });
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
          void onUpdate(update).catch((error: unknown) => {
            const resolvedError = error instanceof Error ? error : new Error(String(error));
            logger.error("telegram_update_failed", { updateId: update.update_id, message: resolvedError.message, error: resolvedError });
          });
        }
      } catch (error) {
        if (stopped && error instanceof Error && error.name === "AbortError") {
          break;
        }

        const resolvedError = error instanceof Error ? error : new Error(String(error));
        logger.error("telegram_polling_failed", { message: resolvedError.message, error: resolvedError });
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
      logger.info("telegram_polling_started");
      loopPromise = loop();
    },
    async stop() {
      stopped = true;
      requestController?.abort();
      const activeLoop = loopPromise;
      loopPromise = undefined;
      await activeLoop;
      logger.info("telegram_polling_stopped");
    },
  };
}
