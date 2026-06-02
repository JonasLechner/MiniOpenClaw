import { getRunnableScheduledTasks, markScheduledTaskRan } from "./task-store.js";
import type { RuntimeState } from "../core/runtime.js";
import type { MainSessionAgent } from "../gateway/agent-runner.js";
import type { TelegramMessageStreamer } from "../transports/telegram/message-streamer.js";
import { runScheduledTask } from "./runner.js";

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

  async function tick(): Promise<void> {
    if (running) return;
    running = true;

    try {
      const tasks = await getRunnableScheduledTasks(runtime.paths);
      for (const task of tasks) {
        try {
          await runScheduledTask(runtime, streamer, task, mainSessionAgent);
          await markScheduledTaskRan(runtime.paths, task.id);
        } catch (error) {
          console.error(`scheduled cron task ${task.id} failed:`, error);
        }
      }
    } catch (error) {
      console.error("scheduled cron tick failed:", error);
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      void tick();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },
  };
}
