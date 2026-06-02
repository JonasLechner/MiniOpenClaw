import { spawn } from "node:child_process";
import type { Sandbox, SandboxExecOptions, SandboxExecResult } from "../sandbox.js";

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

    return new Promise((resolve, reject) => {
      const child = spawn("bash", ["-lc", command], {
        cwd: this.#workspacePath,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";
      let timedOut = false;
      let timeoutHandle: NodeJS.Timeout | undefined;

      child.stdout.on("data", (chunk: Buffer | string) => {
        output += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        output += chunk.toString();
      });

      child.on("error", (error) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        reject(error);
      });

      if (timeout !== undefined) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, timeout * 1000);
      }

      child.on("close", (code) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
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
