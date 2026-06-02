import { promises as fs } from "node:fs";
import { Type } from "@earendil-works/pi-ai";
import { requireToolContext, textToolResult, type ToolDefinition, type ToolRunResult } from "./types.js";
import { DEFAULT_MAX_OUTPUT_BYTES, truncateHead, type TruncationDetails } from "./truncate.js";

export interface ReadInput {
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface ReadDetails {
  truncation?: TruncationDetails;
}

const supportedImageMimeTypes = new Map<string, string>([
  ["ffd8ff", "image/jpeg"],
  ["89504e47", "image/png"],
  ["47494638", "image/gif"],
  ["52494646", "image/webp"],
]);

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("Operation aborted");
  }
}

function detectSupportedImageMimeType(buffer: Buffer): string | undefined {
  const header = buffer.subarray(0, 12).toString("hex");
  for (const [signature, mimeType] of supportedImageMimeTypes) {
    if (header.startsWith(signature)) {
      if (mimeType === "image/webp" && buffer.subarray(8, 12).toString("ascii") !== "WEBP") return undefined;
      return mimeType;
    }
  }
  return undefined;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export const readTool: ToolDefinition<ReadInput, ToolRunResult<ReadDetails>> = {
  name: "read",
  description: "Read a file inside the workspace, optionally by line range. Supports text files and images (jpg, png, gif, webp).",
  parameters: Type.Object({
    path: Type.String(),
    startLine: Type.Optional(Type.Number()),
    endLine: Type.Optional(Type.Number()),
  }),
  async run(input: ReadInput, context) {
    const toolContext = requireToolContext(context);
    throwIfAborted(toolContext.signal);

    const path = await toolContext.workspace.resolvePath(input.path);
    await fs.access(path);
    const buffer = await fs.readFile(path);
    throwIfAborted(toolContext.signal);

    const mimeType = detectSupportedImageMimeType(buffer);
    if (mimeType) {
      return {
        content: [
          { type: "text", text: `Read image file [${mimeType}]` },
          { type: "image", data: buffer.toString("base64"), mimeType },
        ],
      };
    }

    const content = buffer.toString("utf8");
    const allLines = content.split(/\r?\n/);
    if (/\r?\n$/.test(content)) {
      allLines.pop();
    }
    const startLine = input.startLine ?? 1;

    let selectedContent = content;
    let continuationNotice = "";

    if (input.startLine !== undefined || input.endLine !== undefined) {
      if (startLine < 1) {
        throw new Error("startLine must be greater than 0");
      }
      if (input.endLine !== undefined && input.endLine < 1) {
        throw new Error("endLine must be greater than 0");
      }
      if (input.endLine !== undefined && startLine > input.endLine) {
        throw new Error("startLine must be less than or equal to endLine");
      }

      const startIndex = startLine - 1;
      if (startIndex >= allLines.length) {
        throw new Error(`startLine ${startLine} is beyond end of file (${allLines.length} lines total)`);
      }

      const endIndex = input.endLine ?? allLines.length;
      selectedContent = allLines.slice(startIndex, endIndex).join("\n");

      if (endIndex < allLines.length) {
        continuationNotice = `\n\n[${allLines.length - endIndex} more lines in file. Use startLine=${endIndex + 1} to continue.]`;
      }
    }

    const firstSelectedLine = selectedContent.split(/\r?\n/, 1)[0] ?? "";
    if (Buffer.byteLength(firstSelectedLine, "utf8") > DEFAULT_MAX_OUTPUT_BYTES) {
      const sizeKb = Math.round(Buffer.byteLength(firstSelectedLine, "utf8") / 1024);
      return textToolResult(
        `[Line ${startLine} is ${sizeKb}KB, exceeds ${Math.round(DEFAULT_MAX_OUTPUT_BYTES / 1024)}KB limit. Use bash to inspect a slice: sed -n '${startLine}p' ${shellQuote(input.path)} | head -c ${DEFAULT_MAX_OUTPUT_BYTES}]`,
      );
    }

    const truncated = truncateHead(selectedContent);
    const nextLine = startLine + truncated.details.outputLines;
    const endLine = nextLine - 1;
    const notice = truncated.details.truncated
      ? `\n\n[Showing lines ${startLine}-${endLine} of ${allLines.length} (${truncated.details.truncatedBy === "lines" ? `${truncated.details.maxLines} line limit` : `${Math.round(truncated.details.maxBytes / 1024)}KB limit`}). Use startLine=${nextLine} to continue.]`
      : continuationNotice;

    return textToolResult(`${truncated.content}${notice}`, {
      truncation: truncated.details.truncated ? truncated.details : undefined,
    });
  },
};
