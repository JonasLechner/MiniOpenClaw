import { complete, type AssistantMessage, type Message } from "@earendil-works/pi-ai";
import {
  appendAssistantMessageEvent,
  appendErrorEvent,
  appendUserMessageEvent,
  createNewSession,
  ensureCurrentSession,
  type SessionRecord,
} from "../lib/sessions.js";
import { retrieveMemoryFiles, updateSessionSummary } from "../lib/memory.js";
import { runAgentLoop } from "./agent-loop.js";
import { loadAgentEnvironment, type AgentEnvironment } from "./environment.js";
import type { AgentEvent, AgentEventListener, AgentTurnResult } from "./events.js";

export type PromptOptions = {
  onEvent?: AgentEventListener;
};

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

function getVisibleText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function sanitizeGeneratedKeywords(values: unknown): string[] {
  if (!Array.isArray(values)) return [];

  return [...new Set(values.map((value) => String(value).trim().toLowerCase()).filter(Boolean))].slice(0, 12);
}

function parseMemoryMetadataResponse(text: string): { summary?: string; keywords: string[] } {
  const normalized = text.trim();
  if (!normalized) return { keywords: [] };

  const parseJson = (value: string): { summary?: string; keywords: string[] } => {
    const parsed = JSON.parse(value) as { summary?: unknown; keywords?: unknown };
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary.replace(/\s+/g, " ").trim() || undefined : undefined,
      keywords: sanitizeGeneratedKeywords(parsed.keywords),
    };
  };

  try {
    return parseJson(normalized);
  } catch {
    const match = normalized.match(/\{[\s\S]*\}/);
    if (!match) return { keywords: [] };

    try {
      return parseJson(match[0]);
    } catch {
      return { keywords: [] };
    }
  }
}

async function generateMemoryMetadata(
  model: AgentEnvironment["auth"]["model"],
  apiKey: string,
  memory: { category: string; title: string; summary: string; body: string },
): Promise<{ summary?: string; keywords: string[] }> {
  const result = await complete(
    model as Parameters<typeof complete>[0],
    {
      systemPrompt:
        "Generate memory metadata for retrieval. Return JSON only in the shape {\"summary\":\"...\",\"keywords\":[\"keyword\"]}. Write one concise meaningful summary sentence and 5-10 short lowercase keywords. Base both on the full memory content. Avoid ids, turn counts, hashes, timestamps, filler words, roles, and duplicates.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "Generate a summary and keywords for this memory entry.",
                `Category: ${memory.category}`,
                `Title: ${memory.title}`,
                `Summary: ${memory.summary}`,
                "Body:",
                memory.body || "[empty]",
              ].join("\n"),
            },
          ],
          timestamp: Date.now(),
        },
      ],
    },
    { apiKey },
  );

  return parseMemoryMetadataResponse(getVisibleText(result));
}

function buildMemoryPromptBlock(
  memories: Array<{ entry: { title: string; category: string; summary: string }; content: string }>,
): string | undefined {
  if (memories.length === 0) return undefined;

  return [
    "Relevant memory retrieved for this turn:",
    ...memories.map((memory, index) => {
      const excerpt = stripFrontmatter(memory.content).slice(0, 600).trim();
      return [
        `Memory ${index + 1}:`,
        `- Title: ${memory.entry.title}`,
        `- Category: ${memory.entry.category}`,
        `- Summary: ${memory.entry.summary}`,
        "- Content:",
        excerpt || "[empty]",
      ].join("\n");
    }),
    "Use memory only when relevant and do not claim uncertain memory as fact.",
  ].join("\n\n");
}

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
      const retrievedMemories = await retrieveMemoryFiles(this.#runtimePaths.memory, prompt, 3);
      const memoryPromptBlock = buildMemoryPromptBlock(retrievedMemories);
      const systemPrompt = [this.#systemPrompt, memoryPromptBlock].filter(Boolean).join("\n\n");

      const loopResult = await runAgentLoop(
        {
          sessionId,
          prompt,
          systemPrompt: systemPrompt || undefined,
          messages: this.#session.messages as Message[],
          model: this.#model,
          apiKey: this.#apiKey,
          workspacePath: this.#runtimePaths.workspace,
        },
        (event) => this.#emit(event, options?.onEvent),
      );

      await appendAssistantMessageEvent(this.#session, loopResult.message);
      let metadataPromise: Promise<{ summary?: string; keywords: string[] }> | undefined;
      const getMetadata = (memory: { category: string; title: string; summary: string; body: string }) => {
        metadataPromise ??= generateMemoryMetadata(this.#model, this.#apiKey, memory);
        return metadataPromise;
      };

      await updateSessionSummary(this.#runtimePaths.memory, {
        sessionId,
        prompt,
        responseText: loopResult.result.text,
        generateSummary: async (memory) => (await getMetadata(memory)).summary,
        generateKeywords: async (memory) => (await getMetadata(memory)).keywords,
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
