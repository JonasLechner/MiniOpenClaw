import type { Message } from "@earendil-works/pi-ai";
import { buildSystemPrompt } from "../lib/agent-context.js";
import { initializeRuntime, type RuntimeState } from "../lib/runtime.js";
import {
  appendAssistantMessageEvent,
  appendErrorEvent,
  appendUserMessageEvent,
  createNewSession,
  ensureCurrentSession,
  type Session,
} from "../lib/sessions.js";
import { resolveAgentAuth, type AgentAuth } from "./auth.js";
import { runAgentLoop } from "./agent-loop.js";
import type { AgentEvent, AgentEventListener, AgentTurnResult } from "./events.js";
import { persistSessionSummary } from "./session-memory.js";

export type PromptOptions = {
  onEvent?: AgentEventListener;
};

export class Agent {
  readonly provider: string;
  readonly modelId: string;

  #model: AgentAuth["model"];
  #apiKey: string;
  #session: Session;
  #runtimePaths: RuntimeState["paths"];
  #systemPrompt: string;
  #reasoning: string | undefined;
  #listeners = new Set<AgentEventListener>();

  private constructor(auth: AgentAuth, runtime: RuntimeState, session: Session, systemPrompt: string) {
    this.provider = auth.provider;
    this.modelId = auth.modelId;
    this.#model = auth.model;
    this.#apiKey = auth.apiKey;
    this.#session = session;
    this.#runtimePaths = runtime.paths;
    this.#systemPrompt = systemPrompt;
    this.#reasoning = runtime.config.agent?.reasoning;
  }

  static async create(): Promise<Agent> {
    const runtime = initializeRuntime();
    const auth = await resolveAgentAuth(runtime);
    const session = await ensureCurrentSession(runtime.paths);
    const systemPrompt = await buildSystemPrompt(runtime.paths.workspace);
    return new Agent(auth, runtime, session, systemPrompt);
  }

  get sessionId(): string {
    return this.#session.sessionId;
  }

  onEvent(listener: AgentEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async newSession(): Promise<{ sessionId: string }> {
    const nextSession = await createNewSession(this.#runtimePaths);
    this.#switchSession(nextSession);
    this.#emit({ type: "session_switched", sessionId: nextSession.sessionId });
    return { sessionId: nextSession.sessionId };
  }

  async runLoop(prompt: string, options?: PromptOptions): Promise<AgentTurnResult> {
    const sessionId = this.#session.sessionId;
    const userEvent = await appendUserMessageEvent(this.#session, prompt);

    try {
      const loopResult = await runAgentLoop(
        {
          sessionId,
          prompt,
          systemPrompt: this.#systemPrompt,
          messages: this.#session.messages as Message[],
          model: this.#model,
          apiKey: this.#apiKey,
          workspacePath: this.#runtimePaths.workspace,
          reasoning: this.#reasoning,
        },
        (event) => this.#emit(event, options?.onEvent),
      );

      await appendAssistantMessageEvent(this.#session, loopResult.message);
      await persistSessionSummary({
        sessionId,
        prompt,
        responseText: loopResult.result.text,
        memoryRoot: this.#runtimePaths.memory,
        model: this.#model,
        apiKey: this.#apiKey,
      });
      return loopResult.result;
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      await appendErrorEvent(this.#session, resolvedError.message, {
        prompt,
        userTimestamp: userEvent.message.timestamp,
      });
      this.#emit(
        { type: "agent_error", sessionId, message: resolvedError.message, error: resolvedError },
        options?.onEvent,
      );
      throw resolvedError;
    }
  }

  #switchSession(nextSession: Session): void {
    this.#session = nextSession;
  }

  #emit(event: AgentEvent, transient?: AgentEventListener): void {
    transient?.(event);
    for (const listener of this.#listeners) {
      listener(event);
    }
  }
}
