import { cpSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { ensureDir, ensureJsonFile, loadRuntimeConfig, type RuntimeConfig, type RuntimePaths } from "./config.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configureLogging } from "./log.js";

export type RuntimeState = RuntimeConfig;

function getCurrentSessionsPath(paths: RuntimePaths): string {
  return paths.currentSessions ?? join(paths.home, "current-sessions.json");
}

function ensureTextFile(path: string, content: string): void {
  if (existsSync(path)) return;
  writeFileSync(path, content, "utf8");
}

export const WORKSPACE_DOCS_DIRNAME = "miniopenclaw-docs";

function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function copyIfExists(source: string, destination: string): void {
  if (!existsSync(source)) return;
  cpSync(source, destination, { recursive: true });
}

function ensureWorkspaceDocs(workspacePath: string): void {
  const docsRoot = join(workspacePath, WORKSPACE_DOCS_DIRNAME);
  rmSync(docsRoot, { recursive: true, force: true });
  ensureDir(docsRoot);

  const root = packageRoot();
  copyIfExists(join(root, "README.md"), join(docsRoot, "README.md"));
  copyIfExists(join(root, "docs"), join(docsRoot, "docs"));
}

function ensureInitialSkills(workspacePath: string): void {
  const createSkillRoot = join(workspacePath, "skills", "skill-create-new-skill");
  ensureDir(createSkillRoot);
  ensureTextFile(join(createSkillRoot, "SKILL.md"), `---
name: skill-create-new-skill
description: Creates new skills under workspace/skills using the same SKILL.md-based format. Use when the user wants a new skill scaffold or asks how to structure a skill.
---

# skill-create-new-skill

## Purpose
Create a new skill directory under ./skills/<skill-name>/ with a SKILL.md file and any helpful supporting folders.

## Skill requirements
- Skill directory name should match the skill name.
- Use a SKILL.md file with frontmatter.
- Include:
  - name
  - description
- Keep the name lowercase and hyphenated.
- Make the description specific about what the skill does and when to use it.

## Recommended structure

txt
skills/<skill-name>/
  SKILL.md
  scripts/
  references/
  assets/

## SKILL.md template

\`\`\`md
---
name: <skill-name>
description: Explain what this skill does and when to use it.
---

# <skill-name>

## Purpose
Describe the workflow this skill supports.

## Setup
List one-time setup steps if needed.

## Usage
Explain how the agent should use this skill.
\`\`\`

## Creation steps
1. Ask the user for the skill name and purpose if unclear.
2. Create ./skills/<skill-name>/ before writing any files inside it.
3. Write ./skills/<skill-name>/SKILL.md using the template above.
4. Create scripts/, references/, and assets/ only when useful.
5. If a tool cannot create parent directories automatically, create the directory explicitly first.
6. Keep the skill self-contained and concise.
`);
}

export function ensureRuntimeFiles(paths: RuntimePaths): void {
  ensureDir(paths.home);
  ensureDir(paths.sessions);
  ensureDir(paths.workspace);
  ensureDir(join(paths.workspace, "skills"));
  ensureDir(join(paths.workspace, "memory"));

  ensureInitialSkills(paths.workspace);
  ensureWorkspaceDocs(paths.workspace);
  ensureTextFile(join(paths.workspace, "context.md"), "");
  ensureTextFile(join(paths.workspace, "user.md"), "");
  ensureJsonFile(paths.authFile, {});
  ensureJsonFile(paths.conversationBindings, []);
  ensureJsonFile(paths.scheduledTasks, []);
  ensureJsonFile(getCurrentSessionsPath(paths), {});
}

export function initializeRuntime(): RuntimeState {
  const runtime = loadRuntimeConfig();
  configureLogging(runtime.config.logging.level);
  ensureRuntimeFiles(runtime.paths);
  return runtime;
}
