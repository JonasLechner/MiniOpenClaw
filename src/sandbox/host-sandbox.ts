import { spawn } from "node:child_process";
import type { Sandbox, SandboxExecOptions, SandboxExecResult } from "./sandbox.js";

export class HostSandbox implements Sandbox {
  readonly #workspacePath: string;

  constructor(workspacePath: string) {
    this.#workspacePath = workspacePath;
  }

  async ensure(): Promise<void> {
    // no-op
  }

  async exec(command: string, options?: SandboxExecOptions): Promise<SandboxExecResult> {
    const timeout = options?.timeout;
    const signal = options?.signal;

    if (signal?.aborted) {
      throw new DOMException("Command aborted", "AbortError");
    }

    return new Promise((resolve, reject) => {
      const child = spawn("bash", ["-lc", command], {
        cwd: this.#workspacePath,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });

      let output = "";
      let timedOut = false;
      let aborted = false;
      let settled = false;
      let timeoutHandle: NodeJS.Timeout | undefined;

      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        signal?.removeEventListener("abort", abort);
      };

      const killChild = (signalName: NodeJS.Signals) => {
        if (child.pid === undefined) return;
        try {
          process.kill(-child.pid, signalName);
        } catch {
          child.kill(signalName);
        }
      };

      const abort = () => {
        aborted = true;
        killChild("SIGKILL");
      };

      child.stdout.on("data", (chunk: Buffer | string) => {
        output += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        output += chunk.toString();
      });

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      });

      if (timeout !== undefined) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          killChild("SIGTERM");
        }, timeout * 1000);
      }

      signal?.addEventListener("abort", abort, { once: true });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        cleanup();

        if (aborted) {
          reject(new DOMException("Command aborted", "AbortError"));
          return;
        }

        if (timedOut) {
          reject(new Error(`Command timed out after ${timeout} seconds\n\n${output}`.trimEnd()));
          return;
        }

        if (code !== 0) {
          reject(new Error(`${output}${output ? "\n\n" : ""}Command exited with code ${code}`));
          return;
        }

        resolve({ output });
      });
    });
  }
}
