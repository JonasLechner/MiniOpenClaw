import { promises as fs } from "fs";
import { Tool } from "./types";

export interface WriteInput {
  path: string;
  content: string;
}

export interface WriteOutput {
  path: string;
  bytesWritten: number;
}

export const writeTool: Tool<WriteInput, WriteOutput> = {
  name: "write",
  async run(input) {
    await fs.writeFile(input.path, input.content, "utf8");

    return {
      path: input.path,
      bytesWritten: Buffer.byteLength(input.content, "utf8"),
    };
  },
};
