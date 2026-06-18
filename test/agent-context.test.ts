import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { buildSystemPrompt } from "../src/core/agent-context.js";

function yesterdayLocalDate(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const year = yesterday.getFullYear();
  const month = String(yesterday.getMonth() + 1).padStart(2, "0");
  const day = String(yesterday.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

test("buildSystemPrompt includes durable workspace context", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "miniopenclaw-agent-context-"));

  try {
    await writeFile(join(workspace, "context.md"), "keep answers concise", "utf8");
    const prompt = await buildSystemPrompt(workspace);
    assert.match(prompt, /<context>/);
    assert.match(prompt, /keep answers concise/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("buildSystemPrompt includes yesterday's memory file when present", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "miniopenclaw-agent-context-memory-"));

  try {
    const yesterday = yesterdayLocalDate();
    await mkdir(join(workspace, "memory"), { recursive: true });
    await writeFile(join(workspace, "memory", `${yesterday}.md`), "# Yesterday\n\nResolved setup issues.", "utf8");

    const prompt = await buildSystemPrompt(workspace);
    assert.match(prompt, new RegExp(`<yesterday_memory date="${yesterday}" path="memory/${yesterday}\\.md">`));
    assert.match(prompt, /Resolved setup issues/);
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
