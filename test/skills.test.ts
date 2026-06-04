import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { discoverWorkspaceSkills, loadWorkspaceSkillByName, renderSkillsPrompt } from "../src/core/skills.js";

test("discoverWorkspaceSkills finds valid skills and skips incomplete or malformed entries", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "miniopenclaw-skills-"));

  try {
    await mkdir(join(workspace, "skills", "valid-skill"), { recursive: true });
    await writeFile(join(workspace, "skills", "valid-skill", "SKILL.md"), `---
name: valid-skill
description: Useful skill.
---
`, "utf8");

    await mkdir(join(workspace, "skills", "missing-description"), { recursive: true });
    await writeFile(join(workspace, "skills", "missing-description", "SKILL.md"), `---
name: missing-description
---
`, "utf8");

    await mkdir(join(workspace, "skills", "malformed-skill"), { recursive: true });
    await writeFile(join(workspace, "skills", "malformed-skill", "SKILL.md"), `# Missing frontmatter
`, "utf8");

    const skills = await discoverWorkspaceSkills(workspace);
    assert.deepEqual(skills, [{
      name: "valid-skill",
      description: "Useful skill.",
      path: "skills/valid-skill/SKILL.md",
    }]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("loadWorkspaceSkillByName loads skill content by frontmatter name", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "miniopenclaw-skills-load-"));

  try {
    await mkdir(join(workspace, "skills", "valid-skill"), { recursive: true });
    await writeFile(join(workspace, "skills", "valid-skill", "SKILL.md"), `---
name: valid-skill
description: Useful skill.
---

# Valid Skill
`, "utf8");

    const loaded = await loadWorkspaceSkillByName(workspace, "valid-skill");
    assert.equal(loaded?.name, "valid-skill");
    assert.match(loaded?.content ?? "", /# Valid Skill/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("renderSkillsPrompt renders available skills in XML", () => {
  const prompt = renderSkillsPrompt([{ name: "valid-skill", description: "Useful skill.", path: "skills/valid-skill/SKILL.md" }]);
  assert.match(prompt ?? "", /<available_skills>/);
  assert.match(prompt ?? "", /path="skills\/valid-skill\/SKILL\.md"/);
});
