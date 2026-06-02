import { promises as fs } from "fs";
import { Type } from "@earendil-works/pi-ai";
import { resolveWorkspacePath } from "./fs.js";
import type { ToolDefinition } from "./types.js";

export interface EditInput {
  path: string;
  startLine: number;
  endLine: number;
  newText: string;
}

export interface EditOutput {
  path: string;
  replacements: number;
}

export const editTool: ToolDefinition<EditInput, EditOutput> = {
  name: "edit",
  description: "Replace a line range in a file inside the workspace.",
  parameters: Type.Object({
    path: Type.String(),
    startLine: Type.Number(),
    endLine: Type.Number(),
    newText: Type.String(),
  }),
  async run(input: EditInput, context) {
    if (input.startLine < 1 || input.endLine < 1) {
      throw new Error("line numbers must be greater than 0");
    }

    if (input.startLine > input.endLine) {
      throw new Error("startLine must be less than or equal to endLine");
    }

    const path = await resolveWorkspacePath(input.path, context);
    const content = await fs.readFile(path, "utf8");
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const hasTrailingNewline = /\r?\n$/.test(content);
    const lines = content.split(/\r?\n/);

    if (hasTrailingNewline) {
      lines.pop();
    }

    if (input.endLine > lines.length) {
      throw new Error("line range is out of bounds");
    }

    const replacementLines = input.newText.length === 0
      ? []
      : input.newText.split(/\r?\n/);

    lines.splice(input.startLine - 1, input.endLine - input.startLine + 1, ...replacementLines);

    let updatedContent = lines.join(newline);

    if (hasTrailingNewline) {
      updatedContent += newline;
    }

    await fs.writeFile(path, updatedContent, "utf8");

    return {
      path,
      replacements: 1,
    };
  },
};
