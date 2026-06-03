import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import type { RuntimePaths } from "../src/core/config.js";
import { ensureRuntimeFiles } from "../src/core/runtime.js";

function createRuntimePaths(root: string): RuntimePaths {
  return {
    home: root,
    configFile: join(root, "config.json"),
    authFile: join(root, "auth.json"),
    sessions: join(root, "sessions"),
    workspace: join(root, "workspace"),
    memory: join(root, "workspace", "memory"),
    conversationBindings: join(root, "conversation-bindings.json"),
    scheduledTasks: join(root, "scheduled-tasks.json"),
  };
}

test("ensureRuntimeFiles creates memory, project, and context workspace paths", () => {
  const root = mkdtempSync(join(tmpdir(), "miniopenclaw-runtime-test-"));

  try {
    const paths = createRuntimePaths(root);
    ensureRuntimeFiles(paths);

    assert.equal(existsSync(join(paths.workspace, "memory")), true);
    assert.equal(existsSync(join(paths.workspace, "project")), true);
    assert.equal(existsSync(join(paths.workspace, "context.md")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
