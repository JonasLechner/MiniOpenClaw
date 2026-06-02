import { createLogger } from "../core/log.js";
import type { RuntimeState } from "../core/runtime.js";
import type { MainSessionAgent } from "../gateway/agent-runner.js";
import type { TelegramMessageStreamer } from "../transports/telegram/message-streamer.js";
import { runScheduledTask } from "./runner.js";
import { getRunnableScheduledTasks, markScheduledTaskRan } from "./task-store.js";

const DEFAULT_JOBS_POLL_INTERVAL_MS = 60_000;

export type GatewayScheduler = {
  start(): void;
  stop(): void;
};

export function createGatewayScheduler(
  runtime: RuntimeState,
  streamer: TelegramMessageStreamer,
  mainSessionAgent: MainSessionAgent,
): GatewayScheduler {
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  const intervalMs = DEFAULT_JOBS_POLL_INTERVAL_MS;
  const logger = createLogger({ component: "scheduler" });

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    const startedAt = Date.now();

    try {
      logger.debug("scheduler_tick_started", { intervalMs });
      const tasks = await getRunnableScheduledTasks(runtime.paths);
      for (const task of tasks) {
        try {
          logger.info("scheduled_task_started", { taskId: task.id, chatId: task.chatId, target: task.target, kind: task.kind });
          await runScheduledTask(runtime, streamer, task, mainSessionAgent);
          await markScheduledTaskRan(runtime.paths, task.id);
          logger.info("scheduled_task_completed", { taskId: task.id, chatId: task.chatId, target: task.target, kind: task.kind });
        } catch (error) {
          const resolvedError = error instanceof Error ? error : new Error(String(error));
          logger.error("scheduled_task_failed", {
            taskId: task.id,
            chatId: task.chatId,
            target: task.target,
            kind: task.kind,
            message: resolvedError.message,
            error: resolvedError,
          });
        }
      }
      logger.debug("scheduler_tick_completed", { durationMs: Date.now() - startedAt, taskCount: tasks.length });
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      logger.error("scheduler_tick_failed", { durationMs: Date.now() - startedAt, message: resolvedError.message, error: resolvedError });
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) return;
      logger.info("scheduler_started", { intervalMs });
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      void tick();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
      logger.info("scheduler_stopped");
    },
  };
}
