import { Agent } from "../agent/agent.js";
import type { AgentEventListener, AgentTurnResult } from "../agent/events.js";
import type { RuntimeState } from "../lib/runtime.js";
import { createNewSession } from "../lib/sessions.js";
import { logConversationToolCall, type ConversationLogSource } from "./conversation-log.js";

export type PromptLogContext = {
  source: ConversationLogSource;
  chatId: string;
  userId?: string;
  taskId?: string;
};

export type MainSessionAgent = {
  runPrompt(sessionId: string, prompt: string, logContext: PromptLogContext): Promise<AgentTurnResult>;
  bindSession(sessionId: string): Promise<void>;
  appendUserMessage(sessionId: string, prompt: string): Promise<void>;
  dispose(): Promise<void>;
};

function createToolCallLogger(logContext: PromptLogContext): AgentEventListener {
  const startedAt = new Map<string, number>();

  return (event) => {
    if (event.type === "tool_execution_start") {
      startedAt.set(event.toolCallId, Date.now());
      logConversationToolCall({
        phase: "start",
        source: logContext.source,
        chatId: logContext.chatId,
        userId: logContext.userId,
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
        taskId: logContext.taskId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        durationMs: started === undefined ? undefined : Date.now() - started,
        isError: event.result.isError,
      });
    }
  };
}

export function createMainSessionAgent(runtime: RuntimeState): MainSessionAgent {
  let currentSessionId: string | undefined;
  let currentAgentPromise: Promise<Agent> | undefined;
  let lane = Promise.resolve();

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
    runPrompt(sessionId: string, prompt: string, logContext: PromptLogContext): Promise<AgentTurnResult> {
      return enqueue(async () => {
        const agent = await getAgent(sessionId);
        return agent.runLoop(prompt, { onEvent: createToolCallLogger(logContext) });
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
    dispose(): Promise<void> {
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
): Promise<AgentTurnResult> {
  const session = await createNewSession(runtime.paths);
  const agent = await Agent.createForSession(runtime, session.sessionId);

  try {
    return await agent.runLoop(prompt, { onEvent: createToolCallLogger(logContext) });
  } finally {
    await agent.dispose();
  }
}
