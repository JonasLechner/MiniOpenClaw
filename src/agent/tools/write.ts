import { promises as fs } from "fs";
import { resolveWorkspacePath } from "./fs.js";
import type { Tool } from "./types.js";

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
  async run(input: WriteInput, context) {
    const path = await resolveWorkspacePath(input.path, context);
    await fs.writeFile(path, input.content, "utf8");

    return {
      path,
      bytesWritten: Buffer.byteLength(input.content, "utf8"),
    };
  },
};
