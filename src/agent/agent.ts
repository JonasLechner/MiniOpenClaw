import { buildSystemPrompt } from "../lib/agent-context.js";
import type { Sandbox, SandboxFactory } from "../lib/sandbox.js";
import { createSandboxFactory, resolveSandboxEngineKind } from "../lib/sandbox/factory.js";
import { initializeRuntime, type RuntimeState } from "../lib/runtime.js";
import type { Workspace } from "../lib/workspace.js";
import { createHostWorkspace } from "../lib/workspace/host-workspace.js";
import {
  appendAssistantMessageEvent,
  appendErrorEvent,
  appendToolResultMessageEvent,
  appendUserMessageEvent,
  createNewSession,
  ensureCurrentSession,
  getSessionMessages,
  type Session,
} from "../lib/sessions.js";
import { resolveAgentAuth, type AgentAuth } from "./auth.js";
import { AgentLoopExecutionError, runAgentLoop, type AgentLoopResult } from "./agent-loop.js";
import type { AgentEvent, AgentEventListener, AgentTurnResult } from "./events.js";
// import { persistSessionSummary } from "./session-memory.js";

export type PromptOptions = {
  onEvent?: AgentEventListener;
  signal?: AbortSignal;
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
  #sandboxFactory: SandboxFactory;
  #workspace: Workspace;
  #sandbox: Sandbox | undefined;
  #listeners = new Set<AgentEventListener>();

  private constructor(
    auth: AgentAuth,
    runtime: RuntimeState,
    session: Session,
    systemPrompt: string,
    sandboxFactory: SandboxFactory,
  ) {
    this.provider = auth.provider;
    this.modelId = auth.modelId;
    this.#model = auth.model;
    this.#apiKey = auth.apiKey;
    this.#session = session;
    this.#runtimePaths = runtime.paths;
    this.#systemPrompt = systemPrompt;
    this.#reasoning = runtime.config.agent.reasoning;
    this.#sandboxFactory = sandboxFactory;
    this.#workspace = createHostWorkspace(runtime.paths.workspace);
  }

  static async create(): Promise<Agent> {
    const runtime = initializeRuntime();
    const auth = await resolveAgentAuth(runtime);
    const session = await ensureCurrentSession(runtime.paths);
    const systemPrompt = await buildSystemPrompt(runtime.paths.workspace);
    const resolvedEngineKind = await resolveSandboxEngineKind(runtime.config.sandbox);
    const sandboxFactory = await createSandboxFactory(runtime.config.sandbox, resolvedEngineKind);
    return new Agent(auth, runtime, session, systemPrompt, sandboxFactory);
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
    await this.#disposeSandbox();
    this.#switchSession(nextSession);
    this.#emit({ type: "session_switched", sessionId: nextSession.sessionId });
    return { sessionId: nextSession.sessionId };
  }

  async runLoop(prompt: string, options?: PromptOptions): Promise<AgentTurnResult> {
    const sessionId = this.#session.sessionId;
    const userEvent = await appendUserMessageEvent(this.#session, prompt);

    try {
      const loopResult = await runAgentLoop({
        sessionId,
        prompt,
        systemPrompt: this.#systemPrompt,
        messages: getSessionMessages(this.#session),
        model: this.#model,
        apiKey: this.#apiKey,
        workspace: this.#workspace,
        sandbox: this.#getSandbox(),
        reasoning: this.#reasoning,
        signal: options?.signal,
      }, (event) => this.#emit(event, options?.onEvent));

      await this.#persistGeneratedMessages(loopResult.generatedMessages);

      // Await any previous background persist so session summaries don't race on the same file
      // await this.#persistPromise;
      // this.#persistPromise = persistSessionSummary({
      //   sessionId,
      //   prompt,
      //   responseText: loopResult.result.text,
      //   memoryRoot: this.#runtimePaths.memory,
      //   model: this.#model,
      //   apiKey: this.#apiKey,
      // }).catch((err) => {
      //   console.error("Session summary persistence failed:", err instanceof Error ? err.message : String(err));
      // });

      return loopResult.result;
    } catch (error) {
      if (error instanceof AgentLoopExecutionError) {
        await this.#persistGeneratedMessages(error.generatedMessages);
      }

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

  async #persistGeneratedMessages(messages: AgentLoopResult["generatedMessages"]): Promise<void> {
    for (const message of messages) {
      if (message.role === "assistant") {
        await appendAssistantMessageEvent(this.#session, message);
        continue;
      }

      await appendToolResultMessageEvent(this.#session, message);
    }
  }

  #switchSession(nextSession: Session): void {
    this.#session = nextSession;
  }

  #getSandbox(): Sandbox {
    if (!this.#sandbox) {
      this.#sandbox = this.#sandboxFactory.create(this.#session.sessionId, this.#runtimePaths.workspace);
    }

    return this.#sandbox;
  }

  async #disposeSandbox(): Promise<void> {
    // Recreate the sandbox handle if needed so we can clean up session-scoped containers
    // that may outlive this process and were never instantiated in memory here.
    const sandbox = this.#sandbox ?? this.#sandboxFactory.create(this.#session.sessionId, this.#runtimePaths.workspace);
    this.#sandbox = undefined;
    await sandbox.dispose?.("remove");
  }

  #emit(event: AgentEvent, transient?: AgentEventListener): void {
    transient?.(event);
    for (const listener of this.#listeners) {
      listener(event);
    }
  }
}
