import { basename } from "node:path";
import { stdin as input } from "node:process";
import { fileURLToPath } from "node:url";
import { initializeRuntime } from "../core/runtime.js";
import { needsOnboarding } from "../core/onboarding.js";
import { runOnboarding } from "../onboarding/runner.js";
import { launchStartupSandbox } from "../sandbox/startup.js";
import { Agent } from "./agent.js";
import { tuiToolRegistry } from "./tools/tui-tool-registry.js";
import { TuiApp } from "./tui/app.js";

async function runTui(agent: Agent): Promise<void> {
  const app = new TuiApp(agent);
  await app.start();
}

export async function main(): Promise<void> {
  if (!input.isTTY) {
    throw new Error("MiniOpenClaw agent requires an interactive TTY. Use the gateway for non-interactive access.");
  }

  let runtime = initializeRuntime();
  if (needsOnboarding(runtime.paths)) {
    await runOnboarding(runtime);
    runtime = initializeRuntime();
  }

  await launchStartupSandbox(runtime, "agent");
  const agent = await Agent.createForSession(runtime, undefined, { toolRegistry: tuiToolRegistry });

  try {
    await runTui(agent);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const isEntrypoint = basename(process.argv[1] ?? "") === basename(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
