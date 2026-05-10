import { promises as fs } from "fs";
import type { Tool } from "./types.js";

export interface ReadInput {
  path: string;
  startLine?: number;
  endLine?: number;
}

export const readTool: Tool<ReadInput, string> = {
  name: "read",
  async run(input: ReadInput) {
    const content = await fs.readFile(input.path, "utf8");

    if (input.startLine === undefined && input.endLine === undefined) {
      return content;
    }

    const lines = content.split(/\r?\n/);
    const startIndex = Math.max((input.startLine ?? 1) - 1, 0);
    const endIndex = input.endLine ?? lines.length;

    return lines.slice(startIndex, endIndex).join("\n");
  },
};
