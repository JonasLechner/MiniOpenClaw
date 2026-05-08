import { complete, type Context } from "@earendil-works/pi-ai";
import { resolveAgentAuth } from "./auth.js";

export type AgentTurnResult = {
  text: string;
  stopReason: Awaited<ReturnType<typeof complete>>["stopReason"];
  errorMessage?: string;
};

export type AgentLoop = {
  provider: string;
  modelId: string;
  runTurn(prompt: string): Promise<AgentTurnResult>;
};

function getVisibleText(message: Awaited<ReturnType<typeof complete>>): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export async function createAgentLoop(): Promise<AgentLoop> {
  const { provider, modelId, model, apiKey } = await resolveAgentAuth();
  const context: Context = {
    systemPrompt: "You are a helpful assistant. Keep answers concise.",
    messages: [],
  };

  return {
    provider,
    modelId,
    async runTurn(prompt: string): Promise<AgentTurnResult> {
      context.messages.push({
        role: "user",
        content: prompt,
        timestamp: Date.now(),
      });

      const response = await complete(model, context, { apiKey });
      context.messages.push(response);

      return {
        text: getVisibleText(response),
        stopReason: response.stopReason,
        errorMessage: response.errorMessage,
      };
    },
  };
}
