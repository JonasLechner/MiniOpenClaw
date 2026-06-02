import { Type } from "@earendil-works/pi-ai";
import { requireToolContext, textToolResult, type ToolDefinition, type ToolRunResult } from "./types.js";
import { truncateHead, truncationNotice, type TruncationDetails } from "./truncate.js";

export interface ReadInput {
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface ReadDetails {
  truncation?: TruncationDetails;
}

export const readTool: ToolDefinition<ReadInput, ToolRunResult<ReadDetails>> = {
  name: "read",
  description: "Read a file inside the workspace, optionally by line range.",
  parameters: Type.Object({
    path: Type.String(),
    startLine: Type.Optional(Type.Number()),
    endLine: Type.Optional(Type.Number()),
  }),
  async run(input: ReadInput, context) {
    const toolContext = requireToolContext(context);
    const content = await toolContext.workspace.readFile(input.path);
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
      const endIndex = input.endLine ?? allLines.length;
      selectedContent = allLines.slice(startIndex, endIndex).join("\n");

      if (endIndex < allLines.length) {
        continuationNotice = `\n\n[${allLines.length - endIndex} more lines in file. Use startLine=${endIndex + 1} to continue.]`;
      }
    }

    const truncated = truncateHead(selectedContent);
    const nextLine = startLine + truncated.details.outputLines;
    const notice = truncationNotice(truncated.details, `Use startLine=${nextLine} to continue.`);

    return textToolResult(`${truncated.content}${notice || continuationNotice}`, {
      truncation: truncated.details.truncated ? truncated.details : undefined,
    });
  },
};
