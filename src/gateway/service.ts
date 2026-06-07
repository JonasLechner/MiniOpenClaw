import { closeSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeState } from "../core/runtime.js";

const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 10_000;
const HEALTH_POLL_MS = 250;

export type GatewayServicePaths = {
  pidFile: string;
  stdoutLog: string;
  stderrLog: string;
};

export type GatewayServiceStatus = {
  state: "running" | "stopped" | "stale";
  pid?: number;
  healthy: boolean;
  paths: GatewayServicePaths;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getGatewayServicePaths(runtime: RuntimeState): GatewayServicePaths {
  return {
    pidFile: join(runtime.paths.home, "gateway.pid"),
    stdoutLog: join(runtime.paths.home, "gateway.log"),
    stderrLog: join(runtime.paths.home, "gateway.err.log"),
  };
}

function readPid(pidFile: string): number | undefined {
  try {
    const value = readFileSync(pidFile, "utf8").trim();
    if (!value) return undefined;
    const pid = Number(value);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function isProcessRunning(pid: number): boolean {
  if (process.platform === "win32") {
    try {
      const result = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
        encoding: "utf8",
        windowsHide: true,
      });
      if (result.error) {
        return false;
      }
      const output = result.stdout.trim();
      if (!output || output.startsWith("INFO:")) {
        return false;
      }
      return output.includes(`,"${pid}"`) || output.includes(`,${pid},`);
    } catch {
      return false;
    }
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function cleanupStalePidFile(pidFile: string, pid: number | undefined): void {
  if (pid === undefined || isProcessRunning(pid)) {
    return;
  }
  unlinkSync(pidFile);
}

function getGatewayHealthUrl(runtime: RuntimeState): string {
  const host = runtime.config.gateway.host === "0.0.0.0" ? "127.0.0.1" : runtime.config.gateway.host;
  return `http://${host}:${runtime.config.gateway.port}/health`;
}

async function probeGatewayHealth(runtime: RuntimeState): Promise<boolean> {
  try {
    const response = await fetch(getGatewayHealthUrl(runtime));
    return response.ok;
  } catch {
    return false;
  }
}

export async function getGatewayServiceStatus(runtime: RuntimeState): Promise<GatewayServiceStatus> {
  const paths = getGatewayServicePaths(runtime);
  const pid = readPid(paths.pidFile);

  if (pid === undefined) {
    return { state: "stopped", healthy: false, paths };
  }

  if (!isProcessRunning(pid)) {
    cleanupStalePidFile(paths.pidFile, pid);
    return { state: "stale", pid, healthy: false, paths };
  }

  return {
    state: "running",
    pid,
    healthy: await probeGatewayHealth(runtime),
    paths,
  };
}

async function waitForGatewayHealth(runtime: RuntimeState, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeGatewayHealth(runtime)) {
      return true;
    }
    await delay(HEALTH_POLL_MS);
  }
  return probeGatewayHealth(runtime);
}

export async function startGatewayService(runtime: RuntimeState): Promise<{ status: GatewayServiceStatus; started: boolean }> {
  const current = await getGatewayServiceStatus(runtime);
  if (current.state === "running") {
    return { status: current, started: false };
  }

  const paths = current.paths;
  const stdoutFd = openSync(paths.stdoutLog, "a");
  const stderrFd = openSync(paths.stderrLog, "a");
  const gatewayEntrypoint = fileURLToPath(new URL("./index.js", import.meta.url));
  const child = spawn(process.execPath, [gatewayEntrypoint], {
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
  });

  closeSync(stdoutFd);
  closeSync(stderrFd);

  if (child.pid === undefined) {
    throw new Error("Gateway process did not expose a pid.");
  }

  writeFileSync(paths.pidFile, `${child.pid}\n`, "utf8");

  const exited = new Promise<false>((resolve) => {
    child.once("exit", () => resolve(false));
    child.once("error", () => resolve(false));
  });
  const healthy = waitForGatewayHealth(runtime, START_TIMEOUT_MS);
  const ready = await Promise.race([healthy, exited]);
  child.unref();

  const status = await getGatewayServiceStatus(runtime);
  if (!ready && status.state !== "running") {
    throw new Error(`Gateway failed to start. See ${paths.stderrLog}`);
  }

  return { status, started: true };
}

async function terminateGatewayProcess(pid: number): Promise<void> {
  if (process.platform === "win32") {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0 || !isProcessRunning(pid)) {
          resolve();
          return;
        }
        reject(new Error(`taskkill failed for gateway process ${pid} with exit code ${code ?? "unknown"}.`));
      });
    });
    return;
  }

  process.kill(pid, "SIGTERM");
}

export async function stopGatewayService(runtime: RuntimeState): Promise<{ status: GatewayServiceStatus; stopped: boolean }> {
  const status = await getGatewayServiceStatus(runtime);
  if (status.state === "stopped") {
    return { status, stopped: false };
  }

  if (status.state === "stale" || status.pid === undefined) {
    rmSync(status.paths.pidFile, { force: true });
    return {
      status: await getGatewayServiceStatus(runtime),
      stopped: false,
    };
  }

  await terminateGatewayProcess(status.pid);
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isProcessRunning(status.pid)) {
      rmSync(status.paths.pidFile, { force: true });
      return {
        status: await getGatewayServiceStatus(runtime),
        stopped: true,
      };
    }
    await delay(HEALTH_POLL_MS);
  }

  throw new Error(`Timed out stopping gateway process ${status.pid}.`);
}

export async function restartGatewayService(runtime: RuntimeState): Promise<GatewayServiceStatus> {
  await stopGatewayService(runtime);
  const { status } = await startGatewayService(runtime);
  return status;
}
