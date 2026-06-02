import { Type } from "@earendil-works/pi-ai";
import { requireToolContext, type ToolDefinition } from "./types.js";

export interface ReadInput {
  path: string;
  startLine?: number;
  endLine?: number;
}

export const readTool: ToolDefinition<ReadInput, string> = {
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

    if (input.startLine === undefined && input.endLine === undefined) {
      return content;
    }

    const lines = content.split(/\r?\n/);
    const startIndex = Math.max((input.startLine ?? 1) - 1, 0);
    const endIndex = input.endLine ?? lines.length;

    return lines.slice(startIndex, endIndex).join("\n");
  },
};
