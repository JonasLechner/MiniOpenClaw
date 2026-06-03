import { randomUUID } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { buildSystemPrompt } from "../core/agent-context.js";
import type { CompactionResult } from "../core/compaction.js";
import { createLogger } from "../core/log.js";
import type { Sandbox, SandboxFactory } from "../sandbox/sandbox.js";
import { createSandboxFactory, resolveSandboxEngineKind } from "../sandbox/factory.js";
import { initializeRuntime, type RuntimeState } from "../core/runtime.js";
import type { Workspace } from "../core/workspace.js";
import { createHostWorkspace } from "../core/host-workspace.js";
import { createNewSession, ensureCurrentSession, getSessionById, type Session } from "../core/sessions.js";
import { resolveAgentAuth, type AgentAuth } from "./auth.js";
import { AgentLoopExecutionError, runAgentLoop } from "./agent-loop.js";
import { runSessionCompaction } from "./session-compaction-service.js";
import { SessionTranscriptStore } from "./session-transcript.js";
import type { AgentEvent, AgentEventListener, AgentTurnResult } from "./events.js";

export type PromptOptions = {
  runId?: string;
  onEvent?: AgentEventListener;
  signal?: AbortSignal;
  toolContext?: {
    channel?: {
      source: string;
      chatId: string;
      userId?: string;
      sessionId?: string;
    };
    background?: import("./tools/types.js").ToolRunContext["background"];
  };
};

export type AgentCreateOptions = {
  sandboxSessionId?: string;
};

const logger = createLogger({ component: "agent" });

export class Agent {
  readonly provider: string;
  readonly modelId: string;

  #model: AgentAuth["model"];
  #apiKey: string;
  #session: Session;
  #runtime: RuntimeState;
  #runtimePaths: RuntimeState["paths"];
  #systemPrompt: string;
  #reasoning: string | undefined;
  #sandboxFactory: SandboxFactory;
  #workspace: Workspace;
  #transcript: SessionTranscriptStore;
  #sandbox: Sandbox | undefined;
  #sandboxSessionId: string;
  #ownsSandbox: boolean;
  #pendingContextAppend: string | undefined;
  #listeners = new Set<AgentEventListener>();

  private constructor(
    auth: AgentAuth,
    runtime: RuntimeState,
    session: Session,
    systemPrompt: string,
    sandboxFactory: SandboxFactory,
    sandboxSessionId: string,
  ) {
    this.provider = auth.provider;
    this.modelId = auth.modelId;
    this.#model = auth.model;
    this.#apiKey = auth.apiKey;
    this.#session = session;
    this.#runtime = runtime;
    this.#runtimePaths = runtime.paths;
    this.#systemPrompt = systemPrompt;
    this.#reasoning = runtime.config.agent.reasoning;
    this.#sandboxFactory = sandboxFactory;
    this.#workspace = createHostWorkspace(runtime.paths.workspace);
    this.#transcript = new SessionTranscriptStore(session);
    this.#sandboxSessionId = sandboxSessionId;
    this.#ownsSandbox = sandboxSessionId === session.sessionId;
  }

  static async create(): Promise<Agent> {
    return this.createForSession();
  }

  static async createForSession(runtime = initializeRuntime(), sessionId?: string, options: AgentCreateOptions = {}): Promise<Agent> {
    const auth = await resolveAgentAuth(runtime);
    const session = sessionId
      ? await getSessionById(runtime.paths, sessionId)
      : await ensureCurrentSession(runtime.paths);

    if (!session) {
      throw new Error(`Unknown session ${sessionId}.`);
    }

    const systemPrompt = await buildSystemPrompt(runtime.paths.workspace);
    const resolvedEngineKind = await resolveSandboxEngineKind(runtime.config.sandbox);
    const sandboxFactory = await createSandboxFactory(runtime.config.sandbox, resolvedEngineKind);
    return new Agent(auth, runtime, session, systemPrompt, sandboxFactory, options.sandboxSessionId ?? session.sessionId);
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

  async dispose(): Promise<void> {
    await this.#disposeSandbox();
    this.#listeners.clear();
  }

  async appendUserMessage(prompt: string): Promise<void> {
    await this.#transcript.appendUserPrompt(prompt);
  }

  async compactSession(trigger: "automatic" | "manual", force = false): Promise<CompactionResult> {
    await this.#refreshApiKey();
    return this.#runCompaction({ trigger, force, runId: randomUUID() });
  }

  async runLoop(prompt: string, options?: PromptOptions): Promise<AgentTurnResult> {
    const sessionId = this.#session.sessionId;
    const runId = options?.runId ?? randomUUID();
    const userEvent = await this.#transcript.appendUserPrompt(prompt);
    const protectedEventIndex = this.#session.events.length - 1; // Protect only the current user prompt from pre-loop compaction.

    try {
      const pendingContextResult = await this.#maybeHandleContextAppend(prompt, runId, options?.onEvent);
      if (pendingContextResult) {
        return pendingContextResult;
      }
      await this.#refreshApiKey();
      this.#systemPrompt = await buildSystemPrompt(this.#runtimePaths.workspace);

      const compaction = await this.#runCompaction({
        trigger: "automatic",
        runId,
        protectedEventIndex,
        transient: options?.onEvent,
      });
      if (compaction.warning) {
        logger.warn("agent_compaction_warning", { sessionId, runId, warning: compaction.warning });
      }

      const loopResult = await runAgentLoop({
        sessionId,
        runId,
        prompt,
        systemPrompt: this.#systemPrompt,
        messages: this.#transcript.getMessages(),
        model: this.#model,
        apiKey: this.#apiKey,
        workspace: this.#workspace,
        sandbox: this.#getSandbox(),
        reasoning: this.#reasoning,
        signal: options?.signal,
        toolContext: options?.toolContext,
      }, (event) => this.#emit(event, options?.onEvent));

      await this.#transcript.persistGeneratedMessages(loopResult.generatedMessages);
      return loopResult.result;
    } catch (error) {
      if (error instanceof AgentLoopExecutionError) {
        await this.#transcript.persistGeneratedMessages(error.generatedMessages);
      }

      const resolvedError = error instanceof Error ? error : new Error(String(error));
      await this.#transcript.appendRunError(resolvedError.message, {
        prompt,
        userTimestamp: userEvent.message.timestamp,
      });
      this.#emit(
        { type: "agent_error", sessionId, runId, message: resolvedError.message, error: resolvedError },
        options?.onEvent,
      );
      throw resolvedError;
    }
  }

  async #maybeHandleContextAppend(prompt: string, runId: string, transient?: AgentEventListener): Promise<AgentTurnResult | undefined> {
    const confirmation = this.#pendingContextAppend ? this.#matchContextConfirmation(prompt) : undefined;
    if (confirmation === "yes") {
      const appended = await this.#appendContextEntry(this.#pendingContextAppend!);
      this.#pendingContextAppend = undefined;
      return this.#returnLocalAssistantResponse(
        appended
          ? "Appended to workspace/context.md."
          : "That content is already present in workspace/context.md.",
        prompt,
        runId,
        transient,
      );
    }

    if (confirmation === "no") {
      this.#pendingContextAppend = undefined;
      return this.#returnLocalAssistantResponse("Okay, I won't append it to workspace/context.md.", prompt, runId, transient);
    }

    const candidate = this.#detectRelevantContext(prompt);
    if (!candidate) return undefined;

    this.#pendingContextAppend = candidate;
    return this.#returnLocalAssistantResponse(
      `That sounds like useful ongoing context. Should I append this to workspace/context.md?\n\n> ${candidate}`,
      prompt,
      runId,
      transient,
    );
  }

  #detectRelevantContext(prompt: string): string | undefined {
    const normalized = prompt.replace(/\s+/g, " ").trim();
    if (!normalized || normalized.length > 240) return undefined;

    const looksRelevant = [
      /^i\s+(prefer|like|use|am|work|usually|always|never)\b/i,
      /\b(always|never)\b.*\b(before|when|for this project)\b/i,
      /\b(for this project|in this project)\b/i,
      /\bask before\b/i,
      /\bkeep (it|the implementation|this) minimal\b/i,
    ].some((pattern) => pattern.test(normalized));

    return looksRelevant ? normalized : undefined;
  }

  #matchContextConfirmation(prompt: string): "yes" | "no" | undefined {
    const normalized = prompt.replace(/\s+/g, " ").trim().toLowerCase();
    if (!normalized) return undefined;
    if (/^(yes|y|sure|ok|okay|append it|save it|please do|do that)\b/.test(normalized)) return "yes";
    if (/^(no|n|nope|don't|do not|not now|skip)\b/.test(normalized)) return "no";
    return undefined;
  }

  async #appendContextEntry(content: string): Promise<boolean> {
    const path = `${this.#runtimePaths.workspace}/context.md`;
    const existing = await readFile(path, "utf8").catch(() => "");
    const normalized = content.trim();
    const entries = existing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (entries.includes(normalized)) {
      return false;
    }

    const prefix = existing.trim().length > 0 ? "\n" : "";
    await appendFile(path, `${prefix}${normalized}\n`, "utf8");
    return true;
  }

  async #returnLocalAssistantResponse(
    text: string,
    prompt: string,
    runId: string,
    transient?: AgentEventListener,
  ): Promise<AgentTurnResult> {
    const message: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text }],
      api: "openai-responses",
      provider: this.provider,
      model: this.modelId,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    this.#emit({ type: "agent_start", sessionId: this.#session.sessionId, runId, prompt }, transient);
    this.#emit({ type: "message_start", sessionId: this.#session.sessionId, runId, messageType: "text_start" }, transient);
    this.#emit({ type: "message_delta", sessionId: this.#session.sessionId, runId, delta: text, providerEvent: { type: "text_delta", contentIndex: 0, delta: text, partial: message } }, transient);
    this.#emit({ type: "message_end", sessionId: this.#session.sessionId, runId, message, text }, transient);

    await this.#transcript.persistGeneratedMessages([message]);
    const result: AgentTurnResult = { text, stopReason: "stop" };
    this.#emit({ type: "turn_end", sessionId: this.#session.sessionId, runId, result }, transient);
    this.#emit({ type: "agent_end", sessionId: this.#session.sessionId, runId, result }, transient);
    return result;
  }

  async #refreshApiKey(): Promise<void> {
    const auth = await resolveAgentAuth(this.#runtime);
    this.#apiKey = auth.apiKey;
  }

  async #runCompaction({
    trigger,
    force = false,
    protectedEventIndex,
    transient,
    runId,
  }: {
    trigger: "automatic" | "manual";
    force?: boolean;
    protectedEventIndex?: number;
    transient?: AgentEventListener;
    runId: string;
  }): Promise<CompactionResult> {
    return runSessionCompaction({
      session: this.#session,
      model: this.#model,
      apiKey: this.#apiKey,
      trigger,
      runId,
      force,
      protectedEventIndex,
      emit: (event) => this.#emitPersistent(event),
      transient,
    });
  }

  #switchSession(nextSession: Session): void {
    this.#session = nextSession;
    this.#transcript.replaceSession(nextSession);
    this.#sandboxSessionId = nextSession.sessionId;
    this.#ownsSandbox = true;
  }

  #getSandbox(): Sandbox {
    if (!this.#sandbox) {
      this.#sandbox = this.#sandboxFactory.create(this.#sandboxSessionId, this.#runtimePaths.workspace);
    }

    return this.#sandbox;
  }

  async #disposeSandbox(): Promise<void> {
    if (!this.#ownsSandbox) {
      this.#sandbox = undefined;
      return;
    }

    // Recreate the sandbox handle if needed so we can clean up session-scoped containers
    // that may outlive this process and were never instantiated in memory here.
    const sandbox = this.#sandbox ?? this.#sandboxFactory.create(this.#sandboxSessionId, this.#runtimePaths.workspace);
    this.#sandbox = undefined;
    await sandbox.dispose?.("remove");
  }

  #emit(event: AgentEvent, transient?: AgentEventListener): void {
    transient?.(event);
    this.#emitPersistent(event);
  }

  #emitPersistent(event: AgentEvent): void {
    for (const listener of this.#listeners) {
      listener(event);
    }
  }
}
