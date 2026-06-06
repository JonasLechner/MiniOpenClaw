import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { createHostWorkspace } from "../src/core/host-workspace.js";
import { refreshWorkspaceSearchIndexForWorkspace } from "../src/core/workspace-search-index.js";
import { HostSandbox } from "../src/sandbox/host-sandbox.js";
import { workspaceSearchTool } from "../src/agent/tools/workspace-search.js";

test("workspaceSearchTool returns the best matching indexed files", async () => {
  const root = await mkdtemp(join(tmpdir(), "miniopenclaw-daily-summary-search-"));

  try {
    await mkdir(join(root, "memory"), { recursive: true });
    await writeFile(join(root, "memory", "2026-06-03.md"), "# Daily summary\n\nWorked on sqlite BM25 search and ranking.\n", "utf8");
    await writeFile(join(root, "memory", "2026-06-05.md"), "# Daily summary\n\nMore sqlite work plus bm25 indexing.\n", "utf8");
    await refreshWorkspaceSearchIndexForWorkspace(root);

    const result = await workspaceSearchTool.run(
      { query: "sqlite bm25", k: 2 },
      { workspace: createHostWorkspace(root), sandbox: new HostSandbox(root) },
    );

    assert.deepEqual(result.details?.matches.map((match) => match.path), [
      "memory/2026-06-05.md",
      "memory/2026-06-03.md",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
