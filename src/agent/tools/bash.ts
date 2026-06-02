import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { Type } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "./types.js";

const DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024;
const DEFAULT_MAX_OUTPUT_LINES = 2000;

export interface BashInput {
  command: string;
  timeout?: number;
}

export interface BashOutput {
  command: string;
  output: string;
  truncated: boolean;
  truncatedBy: "lines" | "bytes" | null;
  totalLines: number;
  totalBytes: number;
  outputLines: number;
  outputBytes: number;
  fullOutputPath?: string;
}

interface TruncationResult {
  output: string;
  truncated: boolean;
  truncatedBy: "lines" | "bytes" | null;
  totalLines: number;
  totalBytes: number;
  outputLines: number;
  outputBytes: number;
}

function countLines(value: string): number {
  if (value.length === 0) {
    return 0;
  }

  return value.split(/\r?\n/).length;
}

function truncateTail(content: string): TruncationResult {
  const totalBytes = Buffer.byteLength(content, "utf8");
  const allLines = content.length === 0 ? [] : content.split(/\r?\n/);
  const totalLines = allLines.length;

  let output = content;
  let truncated = false;
  let truncatedBy: TruncationResult["truncatedBy"] = null;

  if (allLines.length > DEFAULT_MAX_OUTPUT_LINES) {
    output = allLines.slice(-DEFAULT_MAX_OUTPUT_LINES).join("\n");
    truncated = true;
    truncatedBy = "lines";
  }

  const outputBytesAfterLineLimit = Buffer.byteLength(output, "utf8");
  if (outputBytesAfterLineLimit > DEFAULT_MAX_OUTPUT_BYTES) {
    const buffer = Buffer.from(output, "utf8");
    output = buffer.subarray(buffer.length - DEFAULT_MAX_OUTPUT_BYTES).toString("utf8");
    truncated = true;
    truncatedBy = "bytes";
  }

  return {
    output,
    truncated,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: countLines(output),
    outputBytes: Buffer.byteLength(output, "utf8"),
  };
}

async function writeFullOutput(content: string): Promise<string> {
  const directory = await fs.mkdtemp(join(tmpdir(), "miniopenclaw-bash-"));
  const outputPath = join(directory, "output.txt");
  await fs.writeFile(outputPath, content, "utf8");
  return outputPath;
}

function runCommand(command: string, cwd: string, timeout?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-lc", command], {
      cwd,
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

      resolve(output);
    });
  });
}

export const bashTool: ToolDefinition<BashInput, BashOutput> = {
  name: "bash",
  description: "Execute a bash command in the workspace. Returns combined stdout and stderr. Output is truncated to the last 2000 lines or 50KB, whichever is hit first. If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.",
  parameters: Type.Object({
    command: Type.String(),
    timeout: Type.Optional(Type.Number()),
  }),
  async run(input: BashInput, context) {
    if (!context) {
      throw new Error("workspace path is required");
    }

    let fullOutput: string;

    try {
      fullOutput = await runCommand(input.command, context.workspacePath, input.timeout);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const truncated = truncateTail(message);
      const fullOutputPath = truncated.truncated ? await writeFullOutput(message) : undefined;

      throw new Error([
        truncated.output,
        truncated.truncated ? `\n\n[Full output: ${fullOutputPath}]` : "",
      ].join(""), { cause: error });
    }

    const truncated = truncateTail(fullOutput);
    const fullOutputPath = truncated.truncated ? await writeFullOutput(fullOutput) : undefined;

    return {
      command: input.command,
      output: truncated.output,
      truncated: truncated.truncated,
      truncatedBy: truncated.truncatedBy,
      totalLines: truncated.totalLines,
      totalBytes: truncated.totalBytes,
      outputLines: truncated.outputLines,
      outputBytes: truncated.outputBytes,
      fullOutputPath,
    };
  },
};
