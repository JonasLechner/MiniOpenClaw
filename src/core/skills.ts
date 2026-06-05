import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "./log.js";

export type WorkspaceSkill = {
  name: string;
  description: string;
  path: string;
};

export type LoadedWorkspaceSkill = WorkspaceSkill & {
  content: string;
};

const logger = createLogger({ component: "skills" });

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    throw new Error("Skill is missing frontmatter.");
  }

  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) {
      fields[key] = value;
    }
  }
  return fields;
}

export async function discoverWorkspaceSkills(workspacePath: string): Promise<WorkspaceSkill[]> {
  const skillsRoot = join(workspacePath, "skills");
  let names: string[];

  try {
    names = await readdir(skillsRoot);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const skills: WorkspaceSkill[] = [];
  for (const name of names.sort()) {
    const skillRoot = join(skillsRoot, name);
    const skillStats = await stat(skillRoot);
    if (!skillStats.isDirectory()) continue;

    const skillPath = join(skillRoot, "SKILL.md");
    let content: string;
    try {
      content = await readFile(skillPath, "utf8");
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    let frontmatter: Record<string, string>;
    try {
      frontmatter = parseFrontmatter(content);
    } catch (error) {
      logger.warn("workspace_skill_invalid", {
        skillPath,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (!frontmatter.name || !frontmatter.description) {
      continue;
    }

    skills.push({
      name: frontmatter.name,
      description: frontmatter.description,
      path: `skills/${name}/SKILL.md`,
    });
  }

  return skills;
}

export async function loadWorkspaceSkillByName(workspacePath: string, skillName: string): Promise<LoadedWorkspaceSkill | undefined> {
  const skills = await discoverWorkspaceSkills(workspacePath);
  const skill = skills.find((candidate) => candidate.name === skillName);
  if (!skill) {
    return undefined;
  }

  const content = await readFile(join(workspacePath, skill.path), "utf8");
  return { ...skill, content };
}

export async function resolveWorkspaceSkillInvocationPrompt(workspacePath: string, prompt: string): Promise<string> {
  const match = prompt.trim().match(/^\/skill:([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s+([\s\S]*))?$/i);
  if (!match) {
    return prompt;
  }

  const skillName = match[1]?.toLowerCase();
  if (!skillName) {
    return prompt;
  }

  const loadedSkill = await loadWorkspaceSkillByName(workspacePath, skillName);
  if (!loadedSkill) {
    throw new Error(`Unknown workspace skill: ${skillName}`);
  }

  const args = match[2]?.trim();
  return [
    `Follow the workspace skill "${loadedSkill.name}" from ${loadedSkill.path}.`,
    "Read and follow the skill instructions below.",
    "",
    loadedSkill.content.trim(),
    args ? `\nUser: ${args}` : "",
  ].join("\n").trim();
}

export function renderSkillsPrompt(skills: WorkspaceSkill[]): string | undefined {
  if (skills.length === 0) return undefined;

  const items = skills.map((skill) => [
    `  <skill name="${escapeXml(skill.name)}" path="${escapeXml(skill.path)}">`,
    `    <description>${escapeXml(skill.description)}</description>`,
    "  </skill>",
  ].join("\n"));

  return [
    "You have access to workspace skills.",
    "When a task matches a skill, use the read tool to load the referenced SKILL.md before following it.",
    "",
    "<available_skills>",
    items.join("\n"),
    "</available_skills>",
  ].join("\n");
}
