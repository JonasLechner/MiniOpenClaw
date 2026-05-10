import { initializeRuntime, type RuntimeState } from "../lib/runtime.js";
import { resolveAgentAuth, type AgentAuth } from "./auth.js";

export type AgentEnvironment = {
  runtime: RuntimeState;
  auth: AgentAuth;
};

export async function loadAgentEnvironment(): Promise<AgentEnvironment> {
  const runtime = initializeRuntime();
  const auth = await resolveAgentAuth(runtime);
  return { runtime, auth };
}
