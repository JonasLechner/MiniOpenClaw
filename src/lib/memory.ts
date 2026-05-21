import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, posix, relative } from "node:path";

export const memoryCategories = ["projects", "decisions", "preferences", "session-summaries"] as const;

export type MemoryCategory = (typeof memoryCategories)[number];

export type MemoryIndexEntry = {
  path: string;
  title: string;
  category: MemoryCategory;
  keywords: string[];
  updated: string;
  summary: string;
};

export type MemoryIndex = {
  version: 1;
  strategy: {
    rebuild: "lazy";
    ranking: "keyword-first";
  };
  generatedAt: string;
  entries: MemoryIndexEntry[];
};

export type MemoryDocument = {
  entry: MemoryIndexEntry;
  content: string;
  absolutePath: string;
};

export type WriteMemoryEntryInput = {
  category: MemoryCategory;
  title: string;
  summary: string;
  body: string;
  keywords?: string[];
  updated?: string;
};

export type UpdateSessionSummaryInput = {
  sessionId: string;
  prompt: string;
  responseText: string;
};

const defaultMemoryIndex = (): MemoryIndex => ({
  version: 1,
  strategy: {
    rebuild: "lazy",
    ranking: "keyword-first",
  },
  generatedAt: new Date(0).toISOString(),
  entries: [],
});

function isMemoryCategory(value: string): value is MemoryCategory {
  return memoryCategories.includes(value as MemoryCategory);
}

function titleToFileName(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "memory-entry";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function tokenizeKeywords(...parts: string[]): string[] {
  const tokens = parts
    .join(" ")
    .toLowerCase()
    .match(/[a-z0-9]+/g);

  return uniqueStrings(tokens ?? []).slice(0, 32);
}

function extractContentKeywords(...parts: string[]): string[] {
  const stopwords = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "assistant",
    "at",
    "be",
    "but",
    "by",
    "do",
    "for",
    "from",
    "hello",
    "how",
    "i",
    "if",
    "in",
    "is",
    "it",
    "me",
    "my",
    "name",
    "no",
    "not",
    "of",
    "on",
    "or",
    "overview",
    "please",
    "session",
    "so",
    "summary",
    "tell",
    "that",
    "the",
    "this",
    "to",
    "total",
    "turn",
    "turns",
    "user",
    "what",
    "with",
    "you",
    "your",
  ]);

  const looksLikeIdentifier = (token: string): boolean => /^(?=.*\d)(?=.*[a-f])[a-f\d]{4,}$/i.test(token);

  const tokens = (parts.join(" ").toLowerCase().replace(/['’]/g, "").match(/[a-z0-9]+/g) ?? []).filter(
    (token) => token.length >= 3 && !stopwords.has(token) && !looksLikeIdentifier(token),
  );

  return uniqueStrings(tokens).slice(0, 12);
}

function normalizeDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(value).toISOString().slice(0, 10);
}

function escapeScalar(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}

function summarizeText(value: string, maxLength = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatFrontmatter(entry: MemoryIndexEntry): string {
  const keywords = entry.keywords.join(", ");

  return [
    "---",
    `title: ${escapeScalar(entry.title)}`,
    `category: ${entry.category}`,
    `keywords: [${keywords}]`,
    `updated: ${entry.updated}`,
    `summary: ${escapeScalar(entry.summary)}`,
    "---",
    "",
  ].join("\n");
}

function parseArrayValue(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];

  return uniqueStrings(
    trimmed
      .slice(1, -1)
      .split(",")
      .map((value) => value.trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "")),
  );
}

function parseFrontmatter(text: string): { metadata: Record<string, string | string[]>; body: string } {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return { metadata: {}, body: text };
  }

  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") {
    return { metadata: {}, body: text };
  }

  const metadata: Record<string, string | string[]> = {};
  let index = 1;

  while (index < lines.length && lines[index] !== "---") {
    const line = lines[index].trim();
    if (line) {
      const separator = line.indexOf(":");
      if (separator !== -1) {
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        metadata[key] = value.startsWith("[") ? parseArrayValue(value) : value;
      }
    }
    index += 1;
  }

  if (index >= lines.length || lines[index] !== "---") {
    return { metadata: {}, body: text };
  }

  return {
    metadata,
    body: lines.slice(index + 1).join("\n").replace(/^\n+/, ""),
  };
}

async function ensureMemoryDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

function getIndexPath(memoryRoot: string): string {
  return join(memoryRoot, "index.json");
}

function getAbsoluteMemoryFilePath(memoryRoot: string, entryPath: string): string {
  const relativePath = entryPath.replace(/^memory\//, "");
  return join(memoryRoot, ...relativePath.split("/"));
}

function toIndexPath(memoryRoot: string, absolutePath: string): string {
  return posix.join("memory", ...relative(memoryRoot, absolutePath).split(/\\|\//));
}

async function saveMemoryIndex(memoryRoot: string, index: MemoryIndex): Promise<void> {
  await ensureMemoryDir(memoryRoot);
  await writeFile(getIndexPath(memoryRoot), `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

function sortEntries(entries: MemoryIndexEntry[]): MemoryIndexEntry[] {
  return [...entries].sort((left, right) => left.path.localeCompare(right.path));
}

function coerceEntry(raw: Partial<MemoryIndexEntry>): MemoryIndexEntry | undefined {
  if (!raw.path || !raw.title || !raw.category || !isMemoryCategory(raw.category) || !raw.summary) {
    return undefined;
  }

  const keywords = uniqueStrings(raw.keywords ?? []);
  const summary = raw.summary.trim();
  const title = raw.title.trim();
  if (!title || !summary) return undefined;

  return {
    path: raw.path,
    title,
    category: raw.category,
    keywords: keywords.length > 0 ? keywords : tokenizeKeywords(title, summary),
    updated: normalizeDate(raw.updated ?? new Date().toISOString()),
    summary,
  };
}

async function buildEntryFromMarkdown(memoryRoot: string, absolutePath: string): Promise<MemoryIndexEntry | undefined> {
  const raw = await readFile(absolutePath, "utf8");
  const parsed = parseFrontmatter(raw);
  const fileStats = await stat(absolutePath);
  const category = relative(memoryRoot, absolutePath).split(/\\|\//)[0];
  if (!isMemoryCategory(category)) return undefined;

  const titleFromBody = parsed.body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "))
    ?.slice(2)
    .trim();
  const fallbackTitle = basename(absolutePath, ".md").replace(/-/g, " ");
  const summaryFromBody = parsed.body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#"));

  return coerceEntry({
    path: toIndexPath(memoryRoot, absolutePath),
    title: typeof parsed.metadata.title === "string" ? parsed.metadata.title : titleFromBody ?? fallbackTitle,
    category,
    keywords: Array.isArray(parsed.metadata.keywords) ? parsed.metadata.keywords : [],
    updated:
      typeof parsed.metadata.updated === "string"
        ? parsed.metadata.updated
        : fileStats.mtime.toISOString().slice(0, 10),
    summary: typeof parsed.metadata.summary === "string" ? parsed.metadata.summary : summaryFromBody ?? fallbackTitle,
  });
}

export async function loadMemoryIndex(memoryRoot: string): Promise<MemoryIndex> {
  try {
    const content = await readFile(getIndexPath(memoryRoot), "utf8");
    const parsed = JSON.parse(content) as Partial<MemoryIndex>;
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries
          .map((entry) => coerceEntry(entry))
          .filter((entry): entry is MemoryIndexEntry => entry !== undefined)
      : [];

    return {
      version: 1,
      strategy: {
        rebuild: "lazy",
        ranking: "keyword-first",
      },
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : new Date(0).toISOString(),
      entries: sortEntries(entries),
    };
  } catch {
    const index = defaultMemoryIndex();
    await saveMemoryIndex(memoryRoot, index);
    return index;
  }
}

export async function readMemoryFile(memoryRoot: string, entryPath: string): Promise<MemoryDocument> {
  const absolutePath = getAbsoluteMemoryFilePath(memoryRoot, entryPath);
  const content = await readFile(absolutePath, "utf8");
  const entry = await buildEntryFromMarkdown(memoryRoot, absolutePath);

  if (!entry) {
    throw new Error(`Invalid memory file: ${entryPath}`);
  }

  return { entry, content, absolutePath };
}

function getCategoryScore(category: MemoryCategory): number {
  switch (category) {
    case "decisions":
      return 8;
    case "preferences":
      return 7;
    case "projects":
      return 5;
    case "session-summaries":
      return 2;
  }
}

function getRecencyScore(updated: string): number {
  const timestamp = new Date(updated).getTime();
  if (Number.isNaN(timestamp)) return 0;

  const ageInDays = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
  if (ageInDays <= 7) return 4;
  if (ageInDays <= 30) return 2;
  return 0;
}

function scoreIndexedEntry(entry: MemoryIndexEntry, tokens: string[], normalizedQuery: string): number {
  const haystack = {
    keywords: entry.keywords.map((value) => value.toLowerCase()),
    title: entry.title.toLowerCase(),
    summary: entry.summary.toLowerCase(),
  };

  let score = getCategoryScore(entry.category) + getRecencyScore(entry.updated);

  for (const token of tokens) {
    score += haystack.keywords.filter((value) => value === token).length * 12;
    score += haystack.keywords.filter((value) => value !== token && value.includes(token)).length * 6;
    score += haystack.title.includes(token) ? 8 : 0;
    score += haystack.summary.includes(token) ? 5 : 0;
  }

  if (normalizedQuery) {
    score += haystack.title.includes(normalizedQuery) ? 10 : 0;
    score += haystack.summary.includes(normalizedQuery) ? 8 : 0;
  }

  return score;
}

function scoreDocumentContent(content: string, tokens: string[], normalizedQuery: string): number {
  const parsed = parseFrontmatter(content);
  const body = parsed.body.toLowerCase();

  let score = 0;
  for (const token of tokens) {
    score += body.includes(token) ? 3 : 0;
  }

  if (normalizedQuery) {
    score += body.includes(normalizedQuery) ? 8 : 0;
  }

  return score;
}

export async function retrieveMemoryFiles(memoryRoot: string, query: string, limit = 5): Promise<MemoryDocument[]> {
  const tokens = extractContentKeywords(query);
  const normalizedQuery = query.toLowerCase().trim();
  const index = await loadMemoryIndex(memoryRoot);

  if (!normalizedQuery) {
    return [];
  }

  const initiallyRanked = index.entries
    .map((entry) => ({
      entry,
      score: scoreIndexedEntry(entry, tokens, normalizedQuery),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || right.entry.updated.localeCompare(left.entry.updated));

  const candidateEntries = initiallyRanked.slice(0, Math.max(limit * 8, 20)).map((candidate) => candidate.entry);
  const candidateDocuments = await Promise.all(candidateEntries.map((entry) => readMemoryFile(memoryRoot, entry.path)));

  return candidateDocuments
    .map((document) => ({
      document,
      score:
        scoreIndexedEntry(document.entry, tokens, normalizedQuery) +
        scoreDocumentContent(document.content, tokens, normalizedQuery),
    }))
    .sort((left, right) => right.score - left.score || right.document.entry.updated.localeCompare(left.document.entry.updated))
    .slice(0, limit)
    .map((candidate) => candidate.document);
}

export async function writeMemoryEntry(memoryRoot: string, input: WriteMemoryEntryInput): Promise<MemoryDocument> {
  const slug = titleToFileName(input.title);
  const absolutePath = join(memoryRoot, input.category, `${slug}.md`);
  const entry = coerceEntry({
    path: posix.join("memory", input.category, `${slug}.md`),
    title: input.title,
    category: input.category,
    keywords: input.keywords ?? tokenizeKeywords(input.title, input.summary),
    updated: input.updated ?? new Date().toISOString().slice(0, 10),
    summary: input.summary,
  });

  if (!entry) {
    throw new Error("Invalid memory entry input.");
  }

  await ensureMemoryDir(join(memoryRoot, input.category));
  const content = `${formatFrontmatter(entry)}${input.body.trim()}\n`;
  await writeFile(absolutePath, content, "utf8");

  const index = await loadMemoryIndex(memoryRoot);
  const entries = index.entries.filter((candidate) => candidate.path !== entry.path);
  entries.push(entry);
  await saveMemoryIndex(memoryRoot, {
    ...index,
    generatedAt: new Date().toISOString(),
    entries: sortEntries(entries),
  });

  return { entry, content, absolutePath };
}

export async function updateSessionSummary(
  memoryRoot: string,
  input: UpdateSessionSummaryInput,
): Promise<MemoryDocument> {
  const title = `Session ${input.sessionId} summary`;
  const entryPath = posix.join("memory", "session-summaries", `${titleToFileName(title)}.md`);

  let existingBody = "";
  let turnCount = 0;

  try {
    const existing = await readMemoryFile(memoryRoot, entryPath);
    existingBody = parseFrontmatter(existing.content).body.trim();
    turnCount = (existingBody.match(/^## Turn \d+$/gm) ?? []).length;
  } catch {
    // No existing summary yet.
  }

  const nextTurn = turnCount + 1;
  const turnBlock = [
    `## Turn ${nextTurn}`,
    `- User: ${summarizeText(input.prompt, 240) || "[empty prompt]"}`,
    `- Assistant: ${summarizeText(input.responseText, 240) || "[no text response]"}`,
  ].join("\n");

  const body = [
    `# ${title}`,
    "",
    `Total turns: ${nextTurn}`,
    "",
    existingBody,
    existingBody ? "" : "## Overview",
    existingBody ? "" : `- Session id: ${input.sessionId}`,
    existingBody ? "" : "",
    turnBlock,
  ]
    .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
    .join("\n")
    .trim();

  return writeMemoryEntry(memoryRoot, {
    category: "session-summaries",
    title,
    summary: `Session summary for ${input.sessionId} with ${nextTurn} turn${nextTurn === 1 ? "" : "s"}.`,
    body,
    keywords: extractContentKeywords(input.prompt, input.responseText),
  });
}

export async function rebuildMemoryIndex(memoryRoot: string): Promise<MemoryIndex> {
  const entries: MemoryIndexEntry[] = [];

  for (const category of memoryCategories) {
    const categoryPath = join(memoryRoot, category);
    await ensureMemoryDir(categoryPath);

    for (const name of await readdir(categoryPath)) {
      if (!name.endsWith(".md")) continue;
      const entry = await buildEntryFromMarkdown(memoryRoot, join(categoryPath, name));
      if (entry) {
        entries.push(entry);
      }
    }
  }

  const rebuilt: MemoryIndex = {
    version: 1,
    strategy: {
      rebuild: "lazy",
      ranking: "keyword-first",
    },
    generatedAt: new Date().toISOString(),
    entries: sortEntries(entries),
  };

  await saveMemoryIndex(memoryRoot, rebuilt);
  return rebuilt;
}
