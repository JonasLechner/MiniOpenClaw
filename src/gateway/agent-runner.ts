import { Agent } from "../agent/agent.js";
import type { AgentTurnResult } from "../agent/events.js";
import type { RuntimeState } from "../lib/runtime.js";
import { createNewSession } from "../lib/sessions.js";

export type MainSessionAgent = {
  runPrompt(sessionId: string, prompt: string): Promise<AgentTurnResult>;
  bindSession(sessionId: string): Promise<void>;
  appendUserMessage(sessionId: string, prompt: string): Promise<void>;
  dispose(): Promise<void>;
};

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
    runPrompt(sessionId: string, prompt: string): Promise<AgentTurnResult> {
      return enqueue(async () => {
        const agent = await getAgent(sessionId);
        return agent.runLoop(prompt);
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
): Promise<AgentTurnResult> {
  const session = await createNewSession(runtime.paths);
  const agent = await Agent.createForSession(runtime, session.sessionId);

  try {
    return await agent.runLoop(prompt);
  } finally {
    await agent.dispose();
  }
}
