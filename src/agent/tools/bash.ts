import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { requireSandbox, type ToolDefinition } from "./types.js";

const DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024;
const DEFAULT_MAX_OUTPUT_LINES = 2000;

export interface BashInput {
  command: string;
  timeout?: number;
}

export interface BashOutput {
  output: string;
  truncated: boolean;
  fullOutputPath?: string;
}

interface TruncationResult {
  output: string;
  truncated: boolean;
}

function truncateTail(content: string): TruncationResult {
  const allLines = content.length === 0 ? [] : content.split(/\r?\n/);

  let output = content;
  let truncated = false;

  if (allLines.length > DEFAULT_MAX_OUTPUT_LINES) {
    output = allLines.slice(-DEFAULT_MAX_OUTPUT_LINES).join("\n");
    truncated = true;
  }

  const outputBytesAfterLineLimit = Buffer.byteLength(output, "utf8");
  if (outputBytesAfterLineLimit > DEFAULT_MAX_OUTPUT_BYTES) {
    const buffer = Buffer.from(output, "utf8");
    output = buffer.subarray(buffer.length - DEFAULT_MAX_OUTPUT_BYTES).toString("utf8");
    truncated = true;
  }

  return {
    output,
    truncated,
  };
}

async function writeFullOutput(content: string): Promise<string> {
  const directory = await fs.mkdtemp(join(tmpdir(), "miniopenclaw-bash-"));
  const outputPath = join(directory, "output.txt");
  await fs.writeFile(outputPath, content, "utf8");
  return outputPath;
}

export const bashTool: ToolDefinition<BashInput, BashOutput> = {
  name: "bash",
  description: "Execute a bash command in the workspace. Returns combined stdout and stderr. Output is truncated to the last 2000 lines or 50KB, whichever is hit first. If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.",
  parameters: Type.Object({
    command: Type.String(),
    timeout: Type.Optional(Type.Number()),
  }),
  async run(input: BashInput, context) {
    const sandbox = requireSandbox(context);
    let fullOutput: string;

    try {
      fullOutput = (await sandbox.exec(input.command, { timeout: input.timeout })).output;
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
      output: truncated.output,
      truncated: truncated.truncated,
      fullOutputPath,
    };
  },
};
