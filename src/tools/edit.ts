import { promises as fs } from "fs";
import type { Tool } from "./types.js";

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

export const editTool: Tool<EditInput, EditOutput> = {
  name: "edit",
  async run(input: EditInput) {
    if (input.startLine < 1 || input.endLine < 1) {
      throw new Error("line numbers must be greater than 0");
    }

    if (input.startLine > input.endLine) {
      throw new Error("startLine must be less than or equal to endLine");
    }

    const content = await fs.readFile(input.path, "utf8");
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

    await fs.writeFile(input.path, updatedContent, "utf8");

    return {
      path: input.path,
      replacements: 1,
    };
  },
};
