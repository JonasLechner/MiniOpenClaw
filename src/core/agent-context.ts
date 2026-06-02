import { join } from "node:path";
import type { Context, Message } from "@earendil-works/pi-ai";
import { readOptionalFile } from "./config.js";

export async function buildSystemPrompt(workspacePath: string, appendSystemPrompt?: string): Promise<string> {
  const parts: string[] = [
    `You are an expert assistant. You help users by
reading files, executing commands, editing code, and writing new files.

   Guidelines:
   - Be concise in your responses
   - Show file paths clearly when working with files`,
  ];

  const userMd = await readOptionalFile(join(workspacePath, "USER.md"));
  if (userMd?.trim()) {
    parts.push(`\n\n<user_context>\n${userMd.trim()}\n</user_context>`);
  }

  const memoryMd = await readOptionalFile(join(workspacePath, "MEMORY.md"));
  if (memoryMd?.trim()) {
    parts.push(`\n\n<memory_context>\n${memoryMd.trim()}\n</memory_context>`);
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  parts.push(`\n\nCurrent date and time: ${year}-${month}-${day} ${hours}:${minutes}`);
  parts.push(`Current working directory: ${workspacePath}`);

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
