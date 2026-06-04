import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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

test("buildSystemPrompt exposes available workspace skills", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "miniopenclaw-agent-context-skills-"));

  try {
    await mkdir(join(workspace, "skills", "example-skill"), { recursive: true });
    await writeFile(join(workspace, "skills", "example-skill", "SKILL.md"), `---
name: example-skill
description: Helps with example workflows.
---

# Example Skill
`, "utf8");

    const prompt = await buildSystemPrompt(workspace);
    assert.match(prompt, /<available_skills>/);
    assert.match(prompt, /name="example-skill"/);
    assert.match(prompt, /skills\/example-skill\/SKILL\.md/);
    assert.match(prompt, /use the read tool to load the referenced SKILL\.md/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
