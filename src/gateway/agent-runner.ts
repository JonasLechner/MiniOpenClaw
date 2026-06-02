import { randomUUID } from "node:crypto";
import { Agent } from "../agent/agent.js";
import type { AgentEvent, AgentEventListener, AgentTurnResult } from "../agent/events.js";
import { createLogger } from "../core/log.js";
import type { RuntimeState } from "../core/runtime.js";
import { createNewSession } from "../core/sessions.js";
import type { BackgroundTaskLauncher } from "../jobs/background.js";
import { logConversationToolCall, type ConversationLogSource } from "./conversation-log.js";

export type PromptLogContext = {
  source: ConversationLogSource;
  chatId: string;
  userId?: string;
  sessionId?: string;
  runId?: string;
  taskId?: string;
};

export type RunPromptOptions = {
  onEvent?: AgentEventListener;
};

export type MainSessionAgentStatus = {
  provider: string;
  modelId: string;
  activeRunId?: string;
  activeRunStartedAt?: string;
};

export type MainSessionAgent = {
  runPrompt(sessionId: string, prompt: string, logContext: PromptLogContext, options?: RunPromptOptions): Promise<AgentTurnResult>;
  bindSession(sessionId: string): Promise<void>;
  appendUserMessage(sessionId: string, prompt: string): Promise<void>;
  compactSession(sessionId: string): Promise<{ compacted: boolean; warning?: string; estimatedTokensBefore: number; estimatedTokensAfter?: number }>;
  setBackgroundTaskLauncher(backgroundTaskLauncher?: BackgroundTaskLauncher): void;
  stopActiveRun(): boolean;
  getStatus(): MainSessionAgentStatus;
  dispose(): Promise<void>;
};

function createToolCallLogger(logContext: PromptLogContext & { sessionId: string; runId: string }): AgentEventListener {
  const startedAt = new Map<string, number>();

  return (event) => {
    if (event.type === "tool_execution_start") {
      startedAt.set(event.toolCallId, Date.now());
      logConversationToolCall({
        phase: "start",
        source: logContext.source,
        chatId: logContext.chatId,
        userId: logContext.userId,
        sessionId: logContext.sessionId,
        runId: logContext.runId,
        taskId: logContext.taskId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      });
      return;
    }

    if (event.type === "tool_execution_end") {
      const started = startedAt.get(event.toolCallId);
      startedAt.delete(event.toolCallId);
      logConversationToolCall({
        phase: "end",
        source: logContext.source,
        chatId: logContext.chatId,
        userId: logContext.userId,
        sessionId: logContext.sessionId,
        runId: logContext.runId,
        taskId: logContext.taskId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        durationMs: started === undefined ? undefined : Date.now() - started,
        isError: event.result.isError,
      });
    }
  };
}

function handleRunEvent(logger: ReturnType<typeof createLogger>, event: AgentEvent): void {
  if (event.type === "compaction_start") {
    logger.info("agent_compaction_started", { trigger: event.trigger });
    return;
  }

  if (event.type === "compaction_end") {
    const level = event.warning ? logger.warn : logger.info;
    level("agent_compaction_completed", {
      trigger: event.trigger,
      compacted: event.compacted,
      estimatedTokensBefore: event.estimatedTokensBefore,
      estimatedTokensAfter: event.estimatedTokensAfter,
      warning: event.warning,
    });
  }
}

export function createMainSessionAgent(runtime: RuntimeState): MainSessionAgent {
  let currentSessionId: string | undefined;
  let currentAgentPromise: Promise<Agent> | undefined;
  let activeAbortController: AbortController | undefined;
  let activeRunId: string | undefined;
  let activeRunStartedAt: string | undefined;
  let lane = Promise.resolve();
  let backgroundTaskLauncher: BackgroundTaskLauncher | undefined;

  async function clearCurrentAgent(): Promise<void> {
    const previous = currentAgentPromise;
    currentSessionId = undefined;
    currentAgentPromise = undefined;
    if (!previous) return;
    const agent = await previous;
    await agent.dispose();
  }

  async function getAgent(sessionId: string): Promise<Agent> {
    if (currentSessionId === sessionId && currentAgentPromise) {
      return currentAgentPromise;
    }

    await clearCurrentAgent();

    const created = Agent.createForSession(runtime, sessionId).catch((error) => {
      if (currentAgentPromise === created) {
        currentSessionId = undefined;
        currentAgentPromise = undefined;
      }
      throw error;
    });

    currentSessionId = sessionId;
    currentAgentPromise = created;
    return created;
  }

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = lane.catch(() => undefined).then(task);
    lane = next.then(() => undefined, () => undefined);
    return next;
  }

  return {
    runPrompt(sessionId: string, prompt: string, logContext: PromptLogContext, options: RunPromptOptions = {}): Promise<AgentTurnResult> {
      return enqueue(async () => {
        const agent = await getAgent(sessionId);
        const controller = new AbortController();
        const runId = logContext.runId ?? randomUUID();
        const runLogger = createLogger({
          component: "agent",
          sessionId,
          runId,
          source: logContext.source,
          chatId: logContext.chatId,
          userId: logContext.userId,
          taskId: logContext.taskId,
        });
        const toolCallLogger = createToolCallLogger({ ...logContext, sessionId, runId });

        activeAbortController = controller;
        activeRunId = runId;
        activeRunStartedAt = new Date().toISOString();
        runLogger.info("agent_run_started");

        try {
          const result = await agent.runLoop(prompt, {
            runId,
            onEvent(event) {
              toolCallLogger(event);
              handleRunEvent(runLogger, event);
              options.onEvent?.(event);
            },
            signal: controller.signal,
            toolContext: {
              channel: {
                source: logContext.source,
                chatId: logContext.chatId,
                userId: logContext.userId,
                sessionId,
              },
              background: backgroundTaskLauncher,
            },
          });

          if (result.stopReason === "aborted") {
            runLogger.warn("agent_run_aborted", { stopReason: result.stopReason });
          } else if (result.stopReason === "error") {
            runLogger.error("agent_run_completed", {
              stopReason: result.stopReason,
              errorMessage: result.errorMessage,
            });
          } else {
            runLogger.info("agent_run_completed", { stopReason: result.stopReason });
          }

          return result;
        } catch (error) {
          const resolvedError = error instanceof Error ? error : new Error(String(error));
          runLogger.error("agent_run_failed", { message: resolvedError.message, error: resolvedError });
          throw resolvedError;
        } finally {
          if (activeAbortController === controller) {
            activeAbortController = undefined;
            activeRunId = undefined;
            activeRunStartedAt = undefined;
          }
        }
      });
    },
    bindSession(sessionId: string): Promise<void> {
      return enqueue(async () => {
        await getAgent(sessionId);
      });
    },
    appendUserMessage(sessionId: string, prompt: string): Promise<void> {
      return enqueue(async () => {
        const agent = await getAgent(sessionId);
        await agent.appendUserMessage(prompt);
      });
    },
    compactSession(sessionId: string): Promise<{ compacted: boolean; warning?: string; estimatedTokensBefore: number; estimatedTokensAfter?: number }> {
      return enqueue(async () => {
        const agent = await getAgent(sessionId);
        return agent.compactSession("manual", true);
      });
    },
    setBackgroundTaskLauncher(nextBackgroundTaskLauncher?: BackgroundTaskLauncher): void {
      backgroundTaskLauncher = nextBackgroundTaskLauncher;
    },
    stopActiveRun(): boolean {
      if (!activeAbortController || activeAbortController.signal.aborted) {
        return false;
      }
      activeAbortController.abort();
      return true;
    },
    getStatus(): MainSessionAgentStatus {
      return {
        provider: runtime.config.agent.provider ?? "unknown",
        modelId: runtime.config.agent.modelId ?? "unknown",
        activeRunId,
        activeRunStartedAt,
      };
    },
    dispose(): Promise<void> {
      activeAbortController?.abort();
      return enqueue(async () => {
        await clearCurrentAgent();
      });
    },
  };
}

export async function runPromptInDetachedSession(
  runtime: RuntimeState,
  prompt: string,
  logContext: PromptLogContext,
  options: { sandboxSessionId?: string; signal?: AbortSignal } = {},
): Promise<AgentTurnResult & { sessionId: string }> {
  const session = await createNewSession(runtime.paths);
  const runId = logContext.runId ?? randomUUID();
  const logger = createLogger({
    component: "agent",
    sessionId: session.sessionId,
    runId,
    source: logContext.source,
    chatId: logContext.chatId,
    userId: logContext.userId,
    taskId: logContext.taskId,
  });
  const toolCallLogger = createToolCallLogger({ ...logContext, sessionId: session.sessionId, runId });
  const agent = await Agent.createForSession(runtime, session.sessionId, { sandboxSessionId: options.sandboxSessionId });

  try {
    logger.info("agent_run_started");
    const result = await agent.runLoop(prompt, {
      runId,
      onEvent(event) {
        toolCallLogger(event);
        handleRunEvent(logger, event);
      },
      signal: options.signal,
      toolContext: {
        channel: {
          source: logContext.source,
          chatId: logContext.chatId,
          userId: logContext.userId,
          sessionId: session.sessionId,
        },
      },
    });

    if (result.stopReason === "aborted") {
      logger.warn("agent_run_aborted", { stopReason: result.stopReason });
    } else if (result.stopReason === "error") {
      logger.error("agent_run_completed", {
        stopReason: result.stopReason,
        errorMessage: result.errorMessage,
      });
    } else {
      logger.info("agent_run_completed", { stopReason: result.stopReason });
    }

    return { ...result, sessionId: session.sessionId };
  } catch (error) {
    const resolvedError = error instanceof Error ? error : new Error(String(error));
    logger.error("agent_run_failed", { message: resolvedError.message, error: resolvedError });
    throw resolvedError;
  } finally {
    await agent.dispose();
  }
}
