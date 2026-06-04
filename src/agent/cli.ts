import { stdin as input } from "node:process";
import { initializeRuntime } from "../core/runtime.js";
import { needsOnboarding } from "../core/onboarding.js";
import { runOnboarding } from "../onboarding/runner.js";
import { Agent } from "./agent.js";
import { TuiApp } from "./tui/app.js";

async function runTui(agent: Agent): Promise<void> {
  const app = new TuiApp(agent);
  await app.start();
}

async function main(): Promise<void> {
  if (!input.isTTY) {
    throw new Error("MiniOpenClaw agent requires an interactive TTY. Use the gateway for non-interactive access.");
  }

  let runtime = initializeRuntime();
  if (needsOnboarding(runtime.paths)) {
    await runOnboarding(runtime);
    runtime = initializeRuntime();
  }

  const agent = await Agent.createForSession(runtime);

  try {
    await runTui(agent);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
