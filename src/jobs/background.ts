import { randomUUID } from "node:crypto";
import { createLogger } from "../core/log.js";
import type { RuntimeState } from "../core/runtime.js";
import type { MainSessionAgent } from "../gateway/agent-runner.js";
import { runPromptInDetachedSession } from "../gateway/agent-runner.js";
import { logConversationMessage } from "../gateway/conversation-log.js";
import type { TelegramMessageStreamer } from "../transports/telegram/message-streamer.js";

export type BackgroundTaskStatus = "queued" | "running" | "completed" | "failed" | "aborted";

export type BackgroundTaskSummary = {
  taskId: string;
  chatId: string;
  userId?: string;
  parentSessionId: string;
  detachedSessionId?: string;
  prompt: string;
  status: BackgroundTaskStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  stopReason?: string;
  errorMessage?: string;
  resultText?: string;
};

type BackgroundTaskRecord = BackgroundTaskSummary & {
  abortController?: AbortController;
};

export type BackgroundTaskLauncher = {
  launchDetachedPrompt(input: {
    chatId: string;
    userId?: string;
    parentSessionId: string;
    prompt: string;
  }): Promise<{ taskId: string }>;
  listTasks(input: { parentSessionId: string }): Promise<BackgroundTaskSummary[]>;
  stopTask(input: { parentSessionId: string; taskId: string }): Promise<{ stopped: boolean; reason: string }>;
};

const COMPLETED_TASK_RETENTION_MS = 12 * 60 * 60 * 1000;
const BACKGROUND_TASK_LIST_LIMIT = 3;
const TERMINAL_BACKGROUND_TASK_STATUSES = new Set<BackgroundTaskStatus>(["completed", "failed", "aborted"]);

function buildDetachedCompletionContextMessage(input: {
  taskId: string;
  detachedSessionId: string;
  prompt: string;
  resultText: string;
  stopReason: string;
}): string {
  return [
    `Background subagent ${input.taskId} returned for prompt:`,
    input.prompt,
    "",
    `Stop reason: ${input.stopReason}`,
    `Detached session: ${input.detachedSessionId}`,
    "",
    input.resultText,
  ].join("\n");
}

function buildDetachedFailureContextMessage(input: {
  taskId: string;
  prompt: string;
  errorMessage: string;
}): string {
  return [
    `Background subagent ${input.taskId} failed for prompt:`,
    input.prompt,
    "",
    input.errorMessage,
  ].join("\n");
}

function createLane() {
  const lanes = new Map<string, Promise<void>>();

  return function enqueue(key: string, task: () => Promise<void>): void {
    const previous = lanes.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    lanes.set(key, current.finally(() => {
      if (lanes.get(key) === current) {
        lanes.delete(key);
      }
    }));
  };
}

function toSummary(record: BackgroundTaskRecord): BackgroundTaskSummary {
  return {
    taskId: record.taskId,
    chatId: record.chatId,
    userId: record.userId,
    parentSessionId: record.parentSessionId,
    detachedSessionId: record.detachedSessionId,
    prompt: record.prompt,
    status: record.status,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    stopReason: record.stopReason,
    errorMessage: record.errorMessage,
    resultText: record.resultText,
  };
}

async function publishBackgroundTaskCompletion(
  streamer: TelegramMessageStreamer,
  mainSessionAgent: MainSessionAgent,
  record: BackgroundTaskRecord,
): Promise<void> {
  if (!record.detachedSessionId || !record.resultText || !record.stopReason) {
    throw new Error(`Background task ${record.taskId} is missing completion metadata.`);
  }

  await streamer.sendText(record.chatId, record.resultText);
  await mainSessionAgent.appendUserMessage(
    record.parentSessionId,
    buildDetachedCompletionContextMessage({
      taskId: record.taskId,
      detachedSessionId: record.detachedSessionId,
      prompt: record.prompt,
      resultText: record.resultText,
      stopReason: record.stopReason,
    }),
  );
}

async function publishBackgroundTaskFailure(
  streamer: TelegramMessageStreamer,
  mainSessionAgent: MainSessionAgent,
  record: BackgroundTaskRecord,
): Promise<void> {
  if (!record.errorMessage) {
    throw new Error(`Background task ${record.taskId} is missing failure metadata.`);
  }

  const text = `Background task ${record.taskId} failed: ${record.errorMessage}`;
  await streamer.sendText(record.chatId, text);
  await mainSessionAgent.appendUserMessage(
    record.parentSessionId,
    buildDetachedFailureContextMessage({
      taskId: record.taskId,
      prompt: record.prompt,
      errorMessage: record.errorMessage,
    }),
  );
}

export function createBackgroundTaskLauncher(
  runtime: RuntimeState,
  streamer: TelegramMessageStreamer,
  mainSessionAgent: MainSessionAgent,
): BackgroundTaskLauncher {
  const enqueue = createLane();
  const tasks = new Map<string, BackgroundTaskRecord>();
  const rootLogger = createLogger({ component: "background" });

  function pruneExpiredTasks(): void {
    const cutoff = Date.now() - COMPLETED_TASK_RETENTION_MS;
    for (const [taskId, task] of tasks.entries()) {
      if (!TERMINAL_BACKGROUND_TASK_STATUSES.has(task.status)) continue;
      const finishedAt = task.finishedAt ? Date.parse(task.finishedAt) : Number.NaN;
      if (Number.isNaN(finishedAt) || finishedAt >= cutoff) continue;
      tasks.delete(taskId);
    }
  }

  return {
    async launchDetachedPrompt(input) {
      pruneExpiredTasks();

      const taskId = randomUUID();
      const record: BackgroundTaskRecord = {
        taskId,
        chatId: input.chatId,
        userId: input.userId,
        parentSessionId: input.parentSessionId,
        prompt: input.prompt,
        status: "queued",
        createdAt: new Date().toISOString(),
      };
      tasks.set(taskId, record);
      const logger = rootLogger.child({ taskId, chatId: input.chatId, userId: input.userId, sessionId: input.parentSessionId });
      logger.info("background_task_queued", { prompt: input.prompt });

      enqueue(input.parentSessionId, async () => {
        try {
          if (record.status === "aborted") {
            logger.warn("background_task_aborted", { message: "Task was aborted before start." });
            return;
          }

          record.status = "running";
          record.startedAt = new Date().toISOString();
          record.abortController = new AbortController();
          const runId = randomUUID();
          logger.info("background_task_started", { runId, prompt: input.prompt });

          logConversationMessage({
            role: "user",
            source: "telegram-detached",
            chatId: input.chatId,
            userId: input.userId,
            sessionId: input.parentSessionId,
            runId,
            taskId,
            text: input.prompt,
          });

          try {
            const result = await runPromptInDetachedSession(
              runtime,
              input.prompt,
              {
                source: "telegram-detached",
                chatId: input.chatId,
                userId: input.userId,
                sessionId: input.parentSessionId,
                runId,
                taskId,
              },
              { signal: record.abortController.signal },
            );
            const resultText = result.text || "Done.";
            record.detachedSessionId = result.sessionId;
            record.resultText = resultText;
            record.stopReason = result.stopReason;
            record.status = result.stopReason === "aborted" ? "aborted" : "completed";
            record.finishedAt = new Date().toISOString();

            logConversationMessage({
              role: "assistant",
              source: "telegram-detached",
              chatId: input.chatId,
              userId: input.userId,
              sessionId: input.parentSessionId,
              runId,
              taskId,
              stopReason: result.stopReason,
              text: resultText,
            });

            await publishBackgroundTaskCompletion(streamer, mainSessionAgent, record);
            const level = record.status === "aborted" ? logger.warn : logger.info;
            level(record.status === "aborted" ? "background_task_aborted" : "background_task_completed", {
              runId,
              detachedSessionId: result.sessionId,
              stopReason: result.stopReason,
            });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const publishFailureMessage = record.status === "completed" || record.status === "aborted"
              ? `Failed to publish background task ${taskId}: ${errorMessage}`
              : errorMessage;
            record.status = "failed";
            record.errorMessage = publishFailureMessage;
            record.finishedAt = new Date().toISOString();

            logConversationMessage({
              role: "assistant",
              source: "telegram-detached",
              chatId: input.chatId,
              userId: input.userId,
              sessionId: input.parentSessionId,
              runId,
              taskId,
              stopReason: "error",
              text: `Background task ${taskId} failed: ${publishFailureMessage}`,
            });

            await publishBackgroundTaskFailure(streamer, mainSessionAgent, record);
            logger.error("background_task_failed", { runId, message: publishFailureMessage, error: error instanceof Error ? error : undefined });
          } finally {
            record.abortController = undefined;
          }
        } catch (error) {
          const resolvedError = error instanceof Error ? error : new Error(String(error));
          logger.error("background_task_async_boundary_failed", { message: resolvedError.message, error: resolvedError });
        }
      });

      return { taskId };
    },

    async listTasks(input) {
      pruneExpiredTasks();

      const sessionTasks = [...tasks.values()]
        .filter((task) => task.parentSessionId === input.parentSessionId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const activeTasks = sessionTasks.filter((task) => !TERMINAL_BACKGROUND_TASK_STATUSES.has(task.status));
      const terminalTasks = sessionTasks
        .filter((task) => TERMINAL_BACKGROUND_TASK_STATUSES.has(task.status))
        .slice(0, BACKGROUND_TASK_LIST_LIMIT);

      return [...activeTasks, ...terminalTasks].map(toSummary);
    },

    async stopTask(input) {
      pruneExpiredTasks();

      const task = tasks.get(input.taskId);
      if (!task || task.parentSessionId !== input.parentSessionId) {
        return { stopped: false, reason: `Unknown background task ${input.taskId}.` };
      }

      const logger = rootLogger.child({ taskId: input.taskId, sessionId: input.parentSessionId, chatId: task.chatId, userId: task.userId });

      if (task.status === "queued") {
        task.status = "aborted";
        task.stopReason = "aborted";
        task.finishedAt = new Date().toISOString();
        logger.warn("background_task_aborted", { message: "Stopped before start." });
        return { stopped: true, reason: `Stopped background task ${input.taskId}.` };
      }

      if (task.status === "running") {
        task.abortController?.abort();
        logger.warn("background_task_stop_requested");
        return { stopped: true, reason: `Stopping background task ${input.taskId}…` };
      }

      return { stopped: false, reason: `Background task ${input.taskId} is already ${task.status}.` };
    },
  };
}
