import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { createHostWorkspace } from "../src/core/host-workspace.js";
import { createSqliteDailySummaryRepository } from "../src/core/daily-summary-repository.js";
import { HostSandbox } from "../src/sandbox/host-sandbox.js";
import { dailySummarySearchTool } from "../src/agent/tools/daily-summary-search.js";

test("dailySummarySearchTool returns only the best matching paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "miniopenclaw-daily-summary-search-"));
  const repository = createSqliteDailySummaryRepository(join(root, "daily-summaries.sqlite"));

  try {
    await repository.upsert({
      day: "2026-06-03",
      path: "memory/2026-06-03.md",
      content: "# Daily summary\n\nWorked on sqlite BM25 search and ranking.",
    });
    await repository.upsert({
      day: "2026-06-04",
      path: "memory/2026-06-04.md",
      content: "# Daily summary\n\nDiscussed Telegram image handling.",
    });
    await repository.upsert({
      day: "2026-06-05",
      path: "memory/2026-06-05.md",
      content: "# Daily summary\n\nMore sqlite work plus bm25 indexing.",
    });

    const result = await dailySummarySearchTool.run(
      { query: "sqlite bm25", k: 2 },
      { workspace: createHostWorkspace(root), sandbox: new HostSandbox(root) },
    );

    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    assert.equal(text, "memory/2026-06-05.md\nmemory/2026-06-03.md");
    assert.deepEqual(result.details?.paths, [
      "memory/2026-06-05.md",
      "memory/2026-06-03.md",
    ]);
  } finally {
    repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("dailySummarySearchTool backfills existing markdown summaries and returns empty text when there are no matches", async () => {
  const root = await mkdtemp(join(tmpdir(), "miniopenclaw-daily-summary-search-backfill-"));
  const memoryRoot = join(root, "memory");

  try {
    await mkdir(memoryRoot, { recursive: true });
    await writeFile(join(memoryRoot, "2026-06-06.md"), "# Daily summary\n\nWindows preference notes.\n", "utf8");

    const firstResult = await dailySummarySearchTool.run(
      { query: "windows", k: 1 },
      { workspace: createHostWorkspace(root), sandbox: new HostSandbox(root) },
    );
    const firstText = firstResult.content[0]?.type === "text" ? firstResult.content[0].text : "";
    assert.equal(firstText, "memory/2026-06-06.md");

    const emptyResult = await dailySummarySearchTool.run(
      { query: "nonexistent-keyword", k: 1 },
      { workspace: createHostWorkspace(root), sandbox: new HostSandbox(root) },
    );
    const emptyText = emptyResult.content[0]?.type === "text" ? emptyResult.content[0].text : "";
    assert.equal(emptyText, "");
    assert.deepEqual(emptyResult.details?.paths, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
