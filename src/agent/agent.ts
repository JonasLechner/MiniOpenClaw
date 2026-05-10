import type { Message } from "@earendil-works/pi-ai";
import { initializeRuntime } from "../lib/runtime.js";
import {
  appendAssistantMessageEvent,
  appendErrorEvent,
  appendUserMessageEvent,
  createNewSession,
  ensureCurrentSession,
  type SessionRecord,
} from "../lib/sessions.js";
import { resolveAgentAuth } from "./auth.js";
import { runAgentLoop } from "./agent-loop.js";
import type { AgentEvent, AgentEventListener, AgentTurnResult } from "./events.js";

export type PromptOptions = {
  onEvent?: AgentEventListener;
};

export class Agent {
  readonly provider: string;
  readonly modelId: string;

  #model: Awaited<ReturnType<typeof resolveAgentAuth>>["model"];
  #apiKey: string;
  #session: SessionRecord;
  #systemPrompt: string | undefined;
  #listeners = new Set<AgentEventListener>();

  private constructor(
    auth: Awaited<ReturnType<typeof resolveAgentAuth>>,
    session: SessionRecord,
  ) {
    this.provider = auth.provider;
    this.modelId = auth.modelId;
    this.#model = auth.model;
    this.#apiKey = auth.apiKey;
    this.#session = session;
    this.#systemPrompt = undefined;
  }

  static async create(): Promise<Agent> {
    const runtime = initializeRuntime();
    const auth = await resolveAgentAuth();
    const session = await ensureCurrentSession(runtime.paths);
    return new Agent(auth, session);
  }

  get sessionId(): string {
    return this.#session.header.sessionId;
  }

  onEvent(listener: AgentEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async newSession(): Promise<{ sessionId: string }> {
    const runtime = initializeRuntime();
    const nextSession = await createNewSession(runtime.paths);
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
