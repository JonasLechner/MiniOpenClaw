import type { AssistantMessage } from "@earendil-works/pi-ai";

export function getAssistantVisibleText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function getAssistantThinkingBlocks(message: AssistantMessage): string[] {
  return message.content.filter((block) => block.type === "thinking").map((block) => block.thinking);
}
