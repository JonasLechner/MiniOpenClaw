import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { createSqliteDailySummaryRepository, syncDailySummaryMarkdownFiles } from "../src/core/daily-summary-repository.js";

test("sqlite daily summary repository upserts and lists summaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "miniopenclaw-daily-summary-repo-"));
  const dbPath = join(root, "daily-summaries.sqlite");
  const repository = createSqliteDailySummaryRepository(dbPath);

  try {
    await repository.init();

    const first = await repository.upsert({
      day: "2026-06-03",
      content: "# Daily summary\n\nFirst",
      path: "memory/2026-06-03.md",
    });
    const second = await repository.upsert({
      day: "2026-06-04",
      content: "# Daily summary\n\nSecond",
      path: "memory/2026-06-04.md",
    });
    const updated = await repository.upsert({
      day: "2026-06-03",
      content: "# Daily summary\n\nUpdated",
      path: "memory/2026-06-03.md",
    });

    assert.equal(first.day, "2026-06-03");
    assert.equal(second.day, "2026-06-04");
    assert.equal(updated.createdAt, first.createdAt);
    assert.notEqual(updated.updatedAt, first.updatedAt);

    const fetched = await repository.getByDay("2026-06-03");
    assert.equal(fetched?.content, "# Daily summary\n\nUpdated");

    const recent = await repository.listRecent();
    assert.deepEqual(recent.map((entry) => entry.day), ["2026-06-04", "2026-06-03"]);

    const searchResults = await repository.searchPaths("Updated", 1);
    assert.deepEqual(searchResults, ["memory/2026-06-03.md"]);
  } finally {
    repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("syncDailySummaryMarkdownFiles imports updates and rejects symlinks outside workspace memory", async () => {
  const root = await mkdtemp(join(tmpdir(), "miniopenclaw-daily-summary-sync-"));
  const memoryRoot = join(root, "memory");
  const outsideRoot = await mkdtemp(join(tmpdir(), "miniopenclaw-daily-summary-outside-"));
  const repository = createSqliteDailySummaryRepository(join(root, "daily-summaries.sqlite"));

  try {
    await mkdir(memoryRoot, { recursive: true });
    await writeFile(join(memoryRoot, "2026-06-06.md"), "# Daily summary\n\nImported once.\n", "utf8");

    await syncDailySummaryMarkdownFiles(repository, memoryRoot);
    const imported = await repository.getByDay("2026-06-06");
    assert.equal(imported?.path, "memory/2026-06-06.md");
    assert.equal(imported?.content, "# Daily summary\n\nImported once.\n");

    await writeFile(join(memoryRoot, "2026-06-06.md"), "# Daily summary\n\nUpdated after import.\n", "utf8");
    await syncDailySummaryMarkdownFiles(repository, memoryRoot);
    const updated = await repository.getByDay("2026-06-06");
    assert.equal(updated?.content, "# Daily summary\n\nUpdated after import.\n");

    await unlink(join(memoryRoot, "2026-06-06.md"));
    await syncDailySummaryMarkdownFiles(repository, memoryRoot);
    const deleted = await repository.getByDay("2026-06-06");
    assert.equal(deleted, undefined);

    await writeFile(join(outsideRoot, "2026-06-07.md"), "# outside\n", "utf8");
    await symlink(join(outsideRoot, "2026-06-07.md"), join(memoryRoot, "2026-06-07.md"));

    await assert.rejects(
      () => syncDailySummaryMarkdownFiles(repository, memoryRoot),
      /within workspace memory/,
    );
  } finally {
    repository.close();
    await rm(root, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});
