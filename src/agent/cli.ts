import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { Agent } from "./agent.js";
import { TuiApp } from "./tui/app.js";

async function runTui(agent: Agent): Promise<void> {
  const app = new TuiApp(agent);
  await app.start();
}

async function runReadline(agent: Agent): Promise<void> {
  const rl = readline.createInterface({ input, output });

  console.log(`Using ${agent.provider}/${agent.modelId}`);
  console.log("Type /new for a fresh session or /exit to quit.\n");

  try {
    while (true) {
      const prompt = (await rl.question("you> ")).trim();
      if (!prompt) continue;
      if (prompt === "/exit" || prompt === "/quit") break;
      if (prompt === "/new") {
        const session = await agent.newSession();
        console.log(`Started new session ${session.sessionId}.\n`);
        continue;
      }

      let printedText = false;
      let printedPrefix = false;

      const response = await agent.runLoop(prompt, {
        onEvent(event) {
          if (event.type !== "message_delta") return;
          if (!printedPrefix) {
            output.write("llm> ");
            printedPrefix = true;
          }
          output.write(event.delta);
          printedText = true;
        },
      });

      if (printedText) {
        output.write("\n");
      } else {
        console.log(`llm> ${response.text || "[no text response]"}`);
      }

      if (response.stopReason === "error" || response.stopReason === "aborted") {
        console.error(response.errorMessage ?? `Request ended with ${response.stopReason}.`);
      }

      console.log("");
    }
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const agent = await Agent.create();

  if (input.isTTY) {
    try {
      await runTui(agent);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  } else {
    await runReadline(agent);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
