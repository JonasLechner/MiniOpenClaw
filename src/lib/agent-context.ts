import type { Context, Message } from "@earendil-works/pi-ai";

export const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";

export function createAgentContext(messages: Message[]): Context {
  return {
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    messages: [...messages],
  };
}
