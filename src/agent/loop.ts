import type { AgentEventListener, AgentTurnResult } from "./events.js";
import { Agent } from "./agent.js";

export type RunTurnOptions = {
  onEvent?: AgentEventListener;
};

export type AgentLoop = {
  provider: string;
  modelId: string;
  newSession(): Promise<{ sessionId: string }>;
  runLoop(prompt: string, options?: RunTurnOptions): Promise<AgentTurnResult>;
};

export async function createAgentLoop(): Promise<AgentLoop> {
  const agent = await Agent.create();

  return {
    provider: agent.provider,
    modelId: agent.modelId,
    newSession() {
      return agent.newSession();
    },
    runLoop(prompt, runOptions) {
      return agent.runLoop(prompt, runOptions);
    },
  };
}

export { Agent };
export type { AgentTurnResult } from "./events.js";
