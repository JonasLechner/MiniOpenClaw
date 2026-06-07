import { createNewSession } from "../core/sessions.js";
import type { RuntimeState } from "../core/runtime.js";
import { Agent } from "../agent/agent.js";
import type { AgentEvent } from "../agent/events.js";
import { createToolRegistry } from "../agent/tools/tool-registry.js";
import { editTool } from "../agent/tools/edit.js";
import { readTool } from "../agent/tools/read.js";
import { writeTool } from "../agent/tools/write.js";
import { readOnboardingFile } from "./context.js";

export type OnboardingProfileSummary = {
  userMarkdown: string;
  contextMarkdown: string;
};

export type ExistingOnboardingFiles = {
  userMarkdown: string;
  contextMarkdown: string;
};

const onboardingToolRegistry = createToolRegistry([readTool, writeTool, editTool]);
const onboardingSystemPrompt = "Update user.md and context.md for onboarding. Use read/write/edit tools only. Keep both concise and factual.";

function buildPrompt(name: string | undefined, aboutYou: string, existing: ExistingOnboardingFiles): string {
  return [
    `User name: ${name ?? "Unknown"}`,
    "",
    "Update user.md and context.md.",
    "",
    "Requirements:",
    "- Read the existing files first.",
    "- Use the existing file contents below as the starting point.",
    "- user.md should keep stable user facts, preferences, tone, and character cues.",
    "- context.md should keep goals, intended uses for MiniOpenClaw, workflows, and project/context notes.",
    "- Preserve useful prior notes when still relevant, but deduplicate and clean them up.",
    "- Do not invent facts.",
    "- Use concise markdown bullets.",
    "- You must read the files with tools and then use write or edit to update at least one file.",
    "",
    "Current user.md:",
    existing.userMarkdown || "(empty)",
    "",
    "Current context.md:",
    existing.contextMarkdown || "(empty)",
    "",
    "User onboarding answer:",
    aboutYou,
    "",
    "When finished, reply briefly with what you updated.",
  ].join("\n");
}

export async function summarizeOnboardingProfile(
  runtime: RuntimeState,
  name: string | undefined,
  aboutYou: string,
  existing: ExistingOnboardingFiles,
): Promise<OnboardingProfileSummary> {
  const session = await createNewSession(runtime.paths);
  const agent = await Agent.createForSession(runtime, session.sessionId, {
    toolRegistry: onboardingToolRegistry,
    systemPromptOverride: onboardingSystemPrompt,
  });

  let updatedFiles = 0;
  let finalText = "";

  try {
    await agent.runLoop(buildPrompt(name, aboutYou, existing), {
      onEvent(event: AgentEvent) {
        if (event.type === "tool_execution_end" && (event.toolName === "write" || event.toolName === "edit")) {
          updatedFiles += 1;
        }
        if (event.type === "message_end") {
          finalText = event.text;
        }
      },
    });
  } finally {
    await agent.dispose();
  }

  const userMarkdown = (await readOnboardingFile(runtime.paths.workspace, "user.md")).trim();
  const contextMarkdown = (await readOnboardingFile(runtime.paths.workspace, "context.md")).trim();

  if (updatedFiles === 0) {
    const suffix = finalText ? ` Final assistant message: ${finalText}` : "";
    throw new Error(`Onboarding profile setup did not update user.md or context.md.${suffix}`);
  }

  return {
    userMarkdown,
    contextMarkdown,
  };
}
