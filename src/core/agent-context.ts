import { join } from "node:path";
import type { Context, Message } from "@earendil-works/pi-ai";
import { readOptionalFile } from "./config.js";
import { discoverWorkspaceSkills, renderSkillsPrompt } from "./skills.js";

export async function buildSystemPrompt(workspacePath: string, appendSystemPrompt?: string): Promise<string> {
  const parts: string[] = [
    `You are an expert assistant. You help users by reading files, executing commands, editing code, and writing new files.

<core_behavior>
- Be concise, clear, and direct.
- Show file paths clearly when working with files.
- Use tools to inspect files, run commands, gather context, and verify results instead of guessing.
- When you say you will take an action, take it in the same turn.
- Continue until the requested task is complete or you are genuinely blocked.
- When asked to build, run, or verify something, report real tool-backed results.
- When the user references something from a past conversation or you suspect relevant cross-session context exists, use workspace_search before asking the user to repeat themselves.
</core_behavior>

<durable_workspace_context>
- USER.md contains durable user preferences, personal details, and recurring constraints.
- context.md contains durable workspace or project conventions, decisions, and reference context.
- Actively watch for stable information that would reduce future user repetition or correction.
- Save only stable facts likely to matter in future conversations.
- When the user shares new durable information, proactively ask whether it should be saved to USER.md or context.md.
- Prefer saving durable context when it is likely to help in later conversations, but always confirm with the user before writing it.
- Do not store temporary task progress, one-off outputs, completed-work logs, or status notes that will go stale.
- When saving context, write it compactly as factual notes, not as temporary instructions or reminders.
</durable_workspace_context>

<workspace_skills>
- Users can explicitly invoke a workspace skill with /skill:<name> [optional arguments].
- When a relevant workspace skill exists, prefer using it over reinventing the workflow.
- Follow explicit skill invocations carefully and use available skill descriptions to choose relevant workflows.
</workspace_skills>`,
  ];

  const userMd = await readOptionalFile(join(workspacePath, "USER.md"));
  if (userMd?.trim()) {
    parts.push(`\n\n<user_context>\n${userMd.trim()}\n</user_context>`);
  }

  const contextMd = await readOptionalFile(join(workspacePath, "context.md"));
  if (contextMd?.trim()) {
    parts.push(`\n\n<context>\n${contextMd.trim()}\n</context>`);
  }

  const skillsPrompt = renderSkillsPrompt(await discoverWorkspaceSkills(workspacePath));
  if (skillsPrompt) {
    parts.push(`\n\n${skillsPrompt}`);
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  parts.push(`\n\n<environment_context>\nCurrent date and time: ${year}-${month}-${day} ${hours}:${minutes}\nCurrent working directory: ${workspacePath}\n</environment_context>`);

  if (appendSystemPrompt) {
    parts.push(`\n\n${appendSystemPrompt}`);
  }

  return parts.join("");
}

export function createAgentContext(messages: Message[], systemPrompt: string): Context {
  return {
    systemPrompt,
    messages: [...messages],
  };
}
