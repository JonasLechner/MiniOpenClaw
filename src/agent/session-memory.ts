import { complete } from "@earendil-works/pi-ai";
import { updateSessionSummary } from "../lib/memory.js";
import { getAssistantVisibleText } from "../lib/messages.js";
import type { AgentAuth } from "./auth.js";

type SessionMemoryInput = {
  sessionId: string;
  prompt: string;
  responseText: string;
  memoryRoot: string;
  model: AgentAuth["model"];
  apiKey: string;
};

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
  model: AgentAuth["model"],
  apiKey: string,
  memory: { category: string; title: string; summary: string; body: string },
): Promise<{ summary?: string; keywords: string[] }> {
  const result = await complete(
    model as Parameters<typeof complete>[0],
    {
      systemPrompt:
        'Generate memory metadata for retrieval. Return JSON only in the shape {"summary":"...","keywords":["keyword"]}. Write one concise meaningful summary sentence and 5-10 short lowercase keywords. Base both on the full memory content. Avoid ids, turn counts, hashes, timestamps, filler words, roles, and duplicates.',
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

  return parseMemoryMetadataResponse(getAssistantVisibleText(result));
}

export async function persistSessionSummary(input: SessionMemoryInput): Promise<void> {
  let metadataPromise: Promise<{ summary?: string; keywords: string[] }> | undefined;
  const getMetadata = (memory: { category: string; title: string; summary: string; body: string }) => {
    metadataPromise ??= generateMemoryMetadata(input.model, input.apiKey, memory);
    return metadataPromise;
  };

  await updateSessionSummary(input.memoryRoot, {
    sessionId: input.sessionId,
    prompt: input.prompt,
    responseText: input.responseText,
    generateSummary: async (memory) => (await getMetadata(memory)).summary,
    generateKeywords: async (memory) => (await getMetadata(memory)).keywords,
  });
}
