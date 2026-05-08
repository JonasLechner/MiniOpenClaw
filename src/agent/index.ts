import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { complete, type Context } from "@earendil-works/pi-ai";
import { resolveAgentAuth } from "./auth.js";

function getVisibleText(message: Awaited<ReturnType<typeof complete>>): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

async function main(): Promise<void> {
  const { provider, modelId, model, apiKey } = await resolveAgentAuth();

  const rl = readline.createInterface({ input, output });
  const context: Context = {
    systemPrompt: "You are a helpful assistant. Keep answers concise.",
    messages: [],
  };

  console.log(`Using ${provider}/${modelId}`);
  console.log("Type /exit to quit.\n");

  try {
    while (true) {
      const prompt = (await rl.question("you> ")).trim();
      if (!prompt) continue;
      if (prompt === "/exit" || prompt === "/quit") break;

      context.messages.push({
        role: "user",
        content: prompt,
        timestamp: Date.now(),
      });

      const response = await complete(model, context, { apiKey });
      context.messages.push(response);

      const text = getVisibleText(response);
      console.log(`llm> ${text || "[no text response]"}`);

      if (response.stopReason === "error" || response.stopReason === "aborted") {
        console.error(response.errorMessage ?? `Request ended with ${response.stopReason}.`);
      }

      console.log("");
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
