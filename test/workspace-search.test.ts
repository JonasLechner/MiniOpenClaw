import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { createHostWorkspace } from "../src/core/host-workspace.js";
import {
  createSqliteWorkspaceSearchRepository,
  createWorkspaceSearchIndexerForWorkspace,
  refreshWorkspaceSearchIndexForWorkspace,
  syncWorkspaceSearchIndex,
} from "../src/core/workspace-search-index.js";
import { HostSandbox } from "../src/sandbox/host-sandbox.js";
import { workspaceSearchTool } from "../src/agent/tools/workspace-search.js";

test("workspace search indexes the workspace recursively and ranks matches with SQLite FTS5 BM25", async () => {
  const root = await mkdtemp(join(tmpdir(), "miniopenclaw-workspace-search-"));
  const repository = createSqliteWorkspaceSearchRepository(join(root, "workspace-search.sqlite"));

  try {
    await mkdir(join(root, "notes", "nested"), { recursive: true });
    await writeFile(join(root, "notes", "nested", "a.md"), "Worked on sqlite bm25 ranking.\n", "utf8");
    await writeFile(join(root, "notes", "b.md"), "More sqlite work plus bm25 indexing and ranking.\n", "utf8");
    await writeFile(join(root, "notes", "c.md"), "Telegram image handling only.\n", "utf8");

    await syncWorkspaceSearchIndex(repository, root);
    const matches = await repository.search("sqlite bm25", 2);

    assert.deepEqual(matches.map((match) => match.path), [
      "notes/nested/a.md",
      "notes/b.md",
    ]);
  } finally {
    repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace search removes deleted files and the tool returns snippets", async () => {
  const root = await mkdtemp(join(tmpdir(), "miniopenclaw-workspace-search-tool-"));

  try {
    await mkdir(join(root, "memory"), { recursive: true });
    await writeFile(join(root, "memory", "2026-06-06.md"), "# Daily summary\n\nWindows preference notes.\n", "utf8");
    await refreshWorkspaceSearchIndexForWorkspace(root);

    const result = await workspaceSearchTool.run(
      { query: "windows", k: 1 },
      { workspace: createHostWorkspace(root), sandbox: new HostSandbox(root) },
    );

    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    assert.match(text, /memory\/2026-06-06\.md/);
    assert.match(text, /Windows/);
    assert.equal(result.details?.matches[0]?.path, "memory/2026-06-06.md");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace search only refreshes on demand via forceRefresh without a running indexer", async () => {
  const root = await mkdtemp(join(tmpdir(), "miniopenclaw-workspace-search-refresh-"));

  try {
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(join(root, "notes", "a.md"), "Initial indexed note.\n", "utf8");
    await refreshWorkspaceSearchIndexForWorkspace(root);
    await writeFile(join(root, "notes", "b.md"), "Fresh sqlite bm25 note.\n", "utf8");

    const staleResult = await workspaceSearchTool.run(
      { query: "fresh sqlite", k: 5 },
      { workspace: createHostWorkspace(root), sandbox: new HostSandbox(root) },
    );
    assert.equal(staleResult.details?.matches.length, 0);

    const refreshedResult = await workspaceSearchTool.run(
      { query: "fresh sqlite", k: 5, forceRefresh: true },
      { workspace: createHostWorkspace(root), sandbox: new HostSandbox(root) },
    );
    assert.equal(refreshedResult.details?.matches[0]?.path, "notes/b.md");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace search indexer scans on startup and watches file changes while running", async () => {
  const root = await mkdtemp(join(tmpdir(), "miniopenclaw-workspace-search-watcher-"));
  const indexer = createWorkspaceSearchIndexerForWorkspace(root);

  try {
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(join(root, "notes", "a.md"), "Startup scan catches this sqlite note.\n", "utf8");
    await indexer.start();

    let repository = createSqliteWorkspaceSearchRepository(join(root, "workspace-search.sqlite"));
    try {
      const startupMatches = await repository.search("startup sqlite", 5);
      assert.equal(startupMatches[0]?.path, "notes/a.md");
    } finally {
      repository.close();
    }

    await writeFile(join(root, "notes", "b.md"), "Watcher catches fresh bm25 content.\n", "utf8");

    let watchedPath: string | undefined;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      repository = createSqliteWorkspaceSearchRepository(join(root, "workspace-search.sqlite"));
      try {
        watchedPath = (await repository.search("fresh bm25", 5))[0]?.path;
      } finally {
        repository.close();
      }
      if (watchedPath === "notes/b.md") {
        break;
      }
    }

    assert.equal(watchedPath, "notes/b.md");
  } finally {
    await indexer.stop();
    await rm(root, { recursive: true, force: true });
  }
});
