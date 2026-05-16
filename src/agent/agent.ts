import type { Message } from "@earendil-works/pi-ai";
import {
  appendAssistantMessageEvent,
  appendErrorEvent,
  appendUserMessageEvent,
  createNewSession,
  ensureCurrentSession,
  type SessionRecord,
} from "../lib/sessions.js";
import { runAgentLoop } from "./agent-loop.js";
import { loadAgentEnvironment, type AgentEnvironment } from "./environment.js";
import type { AgentEvent, AgentEventListener, AgentTurnResult } from "./events.js";

export type PromptOptions = {
  onEvent?: AgentEventListener;
};

export class Agent {
  readonly provider: string;
  readonly modelId: string;

  #model: AgentEnvironment["auth"]["model"];
  #apiKey: string;
  #session: SessionRecord;
  #runtimePaths: AgentEnvironment["runtime"]["paths"];
  #systemPrompt: string | undefined;
  #listeners = new Set<AgentEventListener>();

  private constructor(environment: AgentEnvironment, session: SessionRecord) {
    this.provider = environment.auth.provider;
    this.modelId = environment.auth.modelId;
    this.#model = environment.auth.model;
    this.#apiKey = environment.auth.apiKey;
    this.#session = session;
    this.#runtimePaths = environment.runtime.paths;
    this.#systemPrompt = undefined;
  }

  static async create(): Promise<Agent> {
    const environment = await loadAgentEnvironment();
    const session = await ensureCurrentSession(environment.runtime.paths);
    return new Agent(environment, session);
  }

  get sessionId(): string {
    return this.#session.header.sessionId;
  }

  onEvent(listener: AgentEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async newSession(): Promise<{ sessionId: string }> {
    const nextSession = await createNewSession(this.#runtimePaths);
    this.#switchSession(nextSession);
    this.#emit({ type: "session_switched", sessionId: nextSession.header.sessionId });
    return { sessionId: nextSession.header.sessionId };
  }

  async runLoop(prompt: string, options?: PromptOptions): Promise<AgentTurnResult> {
    const sessionId = this.#session.header.sessionId;
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
        },
        (event) => this.#emit(event, options?.onEvent),
      );

      await appendAssistantMessageEvent(this.#session, loopResult.message);
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

  #switchSession(nextSession: SessionRecord): void {
    this.#session = nextSession;
  }

  #emit(event: AgentEvent, transient?: AgentEventListener): void {
    transient?.(event);
    for (const listener of this.#listeners) {
      listener(event);
    }
  }
}
