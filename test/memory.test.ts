import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import {
  loadMemoryIndex,
  readMemoryFile,
  rebuildMemoryIndex,
  retrieveMemoryFiles,
  updateSessionSummary,
  writeMemoryEntry,
} from "../src/core/memory.js";

async function withMemoryRoot(run: (memoryRoot: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "miniopenclaw-memory-"));

  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("loadMemoryIndex creates a default index when missing", async () => {
  await withMemoryRoot(async (memoryRoot) => {
    const index = await loadMemoryIndex(memoryRoot);

    assert.equal(index.version, 1);
    assert.equal(index.strategy.rebuild, "lazy");
    assert.equal(index.strategy.ranking, "keyword-first");
    assert.deepEqual(index.entries, []);

    const content = JSON.parse(await readFile(join(memoryRoot, "index.json"), "utf8")) as { version: number };
    assert.equal(content.version, 1);
  });
});

test("writeMemoryEntry writes markdown and updates the index", async () => {
  await withMemoryRoot(async (memoryRoot) => {
    const document = await writeMemoryEntry(memoryRoot, {
      category: "decisions",
      title: "Fix test discovery",
      summary: "Ignore compiled output during test and lint discovery.",
      body: "# Fix test discovery\n\nCompiled artifacts caused false failures.",
      keywords: ["tests", "lint", "dist"],
    });

    assert.equal(document.entry.path, "memory/decisions/fix-test-discovery.md");

    const markdown = await readFile(document.absolutePath, "utf8");
    assert.match(markdown, /title: Fix test discovery/);
    assert.match(markdown, /category: decisions/);

    const index = await loadMemoryIndex(memoryRoot);
    assert.equal(index.entries.length, 1);
    assert.deepEqual(index.entries[0]?.keywords, ["tests", "lint", "dist"]);
  });
});

test("writeMemoryEntry supports llm-generated summary and keywords for any memory", async () => {
  await withMemoryRoot(async (memoryRoot) => {
    const document = await writeMemoryEntry(memoryRoot, {
      category: "preferences",
      title: "Response style",
      summary: "User response preferences.",
      body: "# Response style\n\nThe user prefers concise answers and wants lint run before commit.",
      generateSummary: async (memory) => {
        assert.equal(memory.category, "preferences");
        assert.equal(memory.title, "Response style");
        assert.match(memory.body, /prefers concise answers/i);
        return "User prefers concise answers and wants lint run before commits.";
      },
      generateKeywords: async () => ["concise", "lint", "preferences"],
    });

    assert.equal(document.entry.summary, "User prefers concise answers and wants lint run before commits.");
    assert.deepEqual(document.entry.keywords, ["concise", "lint", "preferences"]);
  });
});

test("readMemoryFile returns the indexed metadata and raw content", async () => {
  await withMemoryRoot(async (memoryRoot) => {
    await writeMemoryEntry(memoryRoot, {
      category: "projects",
      title: "MiniOpenClaw",
      summary: "Minimal TypeScript agent project.",
      body: "# MiniOpenClaw\n\nUses a gateway and an agent CLI.",
    });

    const document = await readMemoryFile(memoryRoot, "memory/projects/miniopenclaw.md");
    assert.equal(document.entry.category, "projects");
    assert.match(document.content, /# MiniOpenClaw/);
  });
});

test("retrieveMemoryFiles ranks keyword matches first", async () => {
  await withMemoryRoot(async (memoryRoot) => {
    await writeMemoryEntry(memoryRoot, {
      category: "decisions",
      title: "Testing strategy",
      summary: "Vitest and lint decisions.",
      body: "# Testing strategy\n\nUse Vitest and ESLint.",
      keywords: ["vitest", "lint", "tests"],
    });

    await writeMemoryEntry(memoryRoot, {
      category: "projects",
      title: "Gateway notes",
      summary: "Fastify gateway behavior.",
      body: "# Gateway notes\n\nRuntime sessions endpoints.",
      keywords: ["gateway", "fastify"],
    });

    const results = await retrieveMemoryFiles(memoryRoot, "vitest tests", 2);
    assert.equal(results.length, 2);
    assert.equal(results[0]?.entry.title, "Testing strategy");
  });
});

test("retrieveMemoryFiles reranks using body content and category weight", async () => {
  await withMemoryRoot(async (memoryRoot) => {
    await writeMemoryEntry(memoryRoot, {
      category: "session-summaries",
      title: "Old build note",
      summary: "General build summary.",
      body: "# Old build note\n\nThe flaky pipeline happens during dependency resolution.",
      keywords: ["build"],
      updated: "2024-01-01",
    });

    await writeMemoryEntry(memoryRoot, {
      category: "decisions",
      title: "Pipeline fix",
      summary: "Decision about CI stability.",
      body: "# Pipeline fix\n\nThe flaky pipeline happens during dependency resolution.",
      keywords: ["ci"],
      updated: "2026-05-21",
    });

    const results = await retrieveMemoryFiles(memoryRoot, "flaky pipeline dependency resolution", 2);
    assert.equal(results.length, 2);
    assert.equal(results[0]?.entry.title, "Pipeline fix");
  });
});

test("updateSessionSummary creates and updates one session summary file per session", async () => {
  await withMemoryRoot(async (memoryRoot) => {
    const first = await updateSessionSummary(memoryRoot, {
      sessionId: "session-123",
      prompt: "hello",
      responseText: "world",
    });

    assert.equal(first.entry.path, "memory/session-summaries/session-session-123-summary.md");
    assert.match(first.content, /Total turns: 1/);
    assert.match(first.content, /## Turn 1/);

    const second = await updateSessionSummary(memoryRoot, {
      sessionId: "session-123",
      prompt: "second question",
      responseText: "second answer",
      generateSummary: async (memory) => {
        assert.match(memory.body, /## Turn 1/);
        assert.match(memory.body, /## Turn 2/);
        return "Conversation includes a greeting and a second question with its answer.";
      },
      generateKeywords: async () => ["question", "second"],
    });

    assert.match(second.content, /Total turns: 2/);
    assert.match(second.content, /## Turn 1/);
    assert.match(second.content, /## Turn 2/);
    assert.equal((second.content.match(/^# Session session-123 summary$/gm) ?? []).length, 1);
    assert.equal((second.content.match(/^Total turns: /gm) ?? []).length, 1);

    const index = await loadMemoryIndex(memoryRoot);
    assert.equal(index.entries.length, 1);
    assert.equal(index.entries[0]?.category, "session-summaries");
    assert.equal(index.entries[0]?.summary, "Conversation includes a greeting and a second question with its answer.");
    assert.ok(index.entries[0]?.keywords.includes("question"));
    assert.ok(index.entries[0]?.keywords.includes("second"));
  });
});

test("rebuildMemoryIndex recreates the index from existing markdown files", async () => {
  await withMemoryRoot(async (memoryRoot) => {
    const decisionsDir = join(memoryRoot, "decisions");
    await writeMemoryEntry(memoryRoot, {
      category: "decisions",
      title: "First decision",
      summary: "A durable decision.",
      body: "# First decision\n\nPersist this.",
      keywords: ["decision", "durable"],
    });

    await writeFile(
      join(decisionsDir, "manual-note.md"),
      "# Manual note\n\nA manually added note about memory retrieval.\n",
      "utf8",
    );

    const rebuilt = await rebuildMemoryIndex(memoryRoot);
    assert.equal(rebuilt.entries.length, 2);
    assert.equal(rebuilt.entries[1]?.path, "memory/decisions/manual-note.md");
    assert.ok(rebuilt.entries[1]?.keywords.includes("manual"));
  });
});
