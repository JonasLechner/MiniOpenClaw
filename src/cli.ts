#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeRuntime } from "./core/runtime.js";
import { main as runAuth } from "./auth-cli.js";
import { runOnboarding } from "./onboarding/runner.js";
import {
  getGatewayServiceStatus,
  restartGatewayService,
  startGatewayService,
  stopGatewayService,
} from "./gateway/service.js";

function resolveBunCommand(cliDirectory: string): string {
  const bundledBun = join(
    dirname(cliDirectory),
    "node_modules",
    "bun",
    "bin",
    platform() === "win32" ? "bun.exe" : "bun",
  );

  return existsSync(bundledBun) ? bundledBun : "bun";
}

function runAgentViaBun(args: string[]): void {
  const cliDirectory = dirname(fileURLToPath(import.meta.url));
  const agentEntrypoint = join(cliDirectory, "agent", "cli.js");
  const result = spawnSync(resolveBunCommand(cliDirectory), [agentEntrypoint, ...args], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });

  const spawnError = result.error as NodeJS.ErrnoException | undefined;
  if (spawnError) {
    if (spawnError.code === "ENOENT") {
      throw new Error("The agent TUI requires Bun. Install Bun and re-run `miniopenclaw` or `miniopenclaw agent`.");
    }
    throw spawnError;
  }

  if (result.signal) {
    throw new Error(`Agent exited from signal ${result.signal}.`);
  }

  if ((result.status ?? 0) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function printUsage(): void {
  console.log(`Usage:
  miniopenclaw                Open the agent TUI
  miniopenclaw agent          Open the agent TUI
  miniopenclaw auth [provider]
  miniopenclaw onboard
  miniopenclaw gateway
  miniopenclaw gateway restart
  miniopenclaw gateway stop
  miniopenclaw gateway status`);
}

function printGatewayStatus(status: Awaited<ReturnType<typeof getGatewayServiceStatus>>): void {
  if (status.state === "running") {
    console.log(`Gateway running (pid ${status.pid}, healthy: ${status.healthy ? "yes" : "no"})`);
    console.log(`Logs: ${status.paths.stdoutLog}`);
    return;
  }

  if (status.state === "stale") {
    console.log(`Gateway not running (stale pid ${status.pid ?? "unknown"} removed)`);
    console.log(`Logs: ${status.paths.stderrLog}`);
    return;
  }

  console.log("Gateway stopped");
  console.log(`Logs: ${status.paths.stdoutLog}`);
}

async function runGatewayCommand(args: string[]): Promise<void> {
  const runtime = initializeRuntime();
  const subcommand = args[0] ?? "start";

  if (subcommand === "start") {
    const { status, started } = await startGatewayService(runtime);
    console.log(started ? "Gateway started" : "Gateway already running");
    printGatewayStatus(status);
    return;
  }

  if (subcommand === "restart") {
    const status = await restartGatewayService(runtime);
    console.log("Gateway restarted");
    printGatewayStatus(status);
    return;
  }

  if (subcommand === "stop") {
    const { status, stopped } = await stopGatewayService(runtime);
    console.log(stopped ? "Gateway stopped" : "Gateway already stopped");
    printGatewayStatus(status);
    return;
  }

  if (subcommand === "status") {
    printGatewayStatus(await getGatewayServiceStatus(runtime));
    return;
  }

  throw new Error(`Unknown gateway subcommand: ${subcommand}`);
}

async function runOnboardCommand(): Promise<void> {
  const runtime = initializeRuntime();
  await runOnboarding(runtime);
  console.log("Onboarding complete.");
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const [command, ...args] = argv;

  if (!command) {
    runAgentViaBun(args);
    return;
  }

  if (command === "agent") {
    runAgentViaBun(args);
    return;
  }

  if (command === "auth") {
    await runAuth(args);
    return;
  }

  if (command === "onboard") {
    await runOnboardCommand();
    return;
  }

  if (command === "gateway") {
    await runGatewayCommand(args);
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

const isEntrypoint = basename(process.argv[1] ?? "") === basename(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
