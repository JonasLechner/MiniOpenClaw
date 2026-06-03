import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { buildSystemPrompt } from "../src/core/agent-context.js";

test("buildSystemPrompt instructs the agent to ask before appending relevant context to context.md", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "miniopenclaw-agent-context-"));

  try {
    const prompt = await buildSystemPrompt(workspace);
    assert.match(prompt, /ask whether it should be appended/i);
    assert.match(prompt, /workspace\/context\.md/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
