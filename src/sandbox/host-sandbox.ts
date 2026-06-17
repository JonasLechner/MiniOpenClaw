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
      const detached = process.platform !== "win32";
      const child = spawn("bash", ["-lc", command], {
        cwd: this.#workspacePath,
        stdio: ["ignore", "pipe", "pipe"],
        detached,
      });

      let output = "";
      let timedOut = false;
      let aborted = false;
      let settled = false;
      let processClosed = false;
      let stdoutEnded = false;
      let stderrEnded = false;
      let exitCode: number | null = null;
      let timeoutHandle: NodeJS.Timeout | undefined;
      let timeoutKillHandle: NodeJS.Timeout | undefined;
      let abortRejectHandle: NodeJS.Timeout | undefined;

      const cleanup = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (timeoutKillHandle) clearTimeout(timeoutKillHandle);
        if (abortRejectHandle) clearTimeout(abortRejectHandle);
        signal?.removeEventListener("abort", abort);
      };

      const killChild = (signalName: NodeJS.Signals) => {
        if (child.pid === undefined) return;

        if (detached) {
          try {
            process.kill(-child.pid, signalName);
            return;
          } catch {
            // Fall through to killing the direct child.
          }
        }

        child.kill(signalName);
      };

      const settle = (handler: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        handler();
      };

      const maybeSettle = () => {
        if (!processClosed || !stdoutEnded || !stderrEnded) return;

        settle(() => {
          if (aborted) {
            reject(new DOMException("Command aborted", "AbortError"));
            return;
          }

          if (timedOut) {
            reject(new Error(`Command timed out after ${timeout} seconds\n\n${output}`.trimEnd()));
            return;
          }

          if (exitCode !== 0) {
            reject(new Error(`${output}${output ? "\n\n" : ""}Command exited with code ${exitCode}`));
            return;
          }

          resolve({ output });
        });
      };

      const abort = () => {
        aborted = true;
        killChild("SIGKILL");
        abortRejectHandle = setTimeout(() => {
          processClosed = true;
          stdoutEnded = true;
          stderrEnded = true;
          maybeSettle();
        }, 250);
      };

      child.stdout.on("data", (chunk: Buffer | string) => {
        output += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        output += chunk.toString();
      });

      child.stdout.on("end", () => {
        stdoutEnded = true;
        maybeSettle();
      });

      child.stderr.on("end", () => {
        stderrEnded = true;
        maybeSettle();
      });

      child.on("error", (error) => {
        settle(() => reject(error));
      });

      if (timeout !== undefined) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          killChild("SIGTERM");
          timeoutKillHandle = setTimeout(() => {
            killChild("SIGKILL");
          }, 250);
        }, timeout * 1000);
      }

      signal?.addEventListener("abort", abort, { once: true });

      child.on("close", (code) => {
        processClosed = true;
        exitCode = code;
        maybeSettle();
      });
    });
  }
}
