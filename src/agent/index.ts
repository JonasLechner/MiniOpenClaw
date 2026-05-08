import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createAgentLoop } from "./loop.js";

async function main(): Promise<void> {
  const agent = await createAgentLoop();
  const rl = readline.createInterface({ input, output });

  console.log(`Using ${agent.provider}/${agent.modelId}`);
  console.log("Type /exit to quit.\n");

  try {
    while (true) {
      const prompt = (await rl.question("you> ")).trim();
      if (!prompt) continue;
      if (prompt === "/exit" || prompt === "/quit") break;

      const response = await agent.runTurn(prompt);
      console.log(`llm> ${response.text || "[no text response]"}`);

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
