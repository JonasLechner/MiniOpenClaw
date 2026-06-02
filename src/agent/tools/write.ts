import { promises as fs } from "fs";
import { Type } from "@earendil-works/pi-ai";
import { resolveWorkspacePath } from "./fs.js";
import type { ToolDefinition } from "./types.js";

export interface WriteInput {
  path: string;
  content: string;
}

export interface WriteOutput {
  path: string;
  bytesWritten: number;
}

export const writeTool: ToolDefinition<WriteInput, WriteOutput> = {
  name: "write",
  description: "Write text to a file inside the workspace.",
  parameters: Type.Object({
    path: Type.String(),
    content: Type.String(),
  }),
  async run(input: WriteInput, context) {
    const path = await resolveWorkspacePath(input.path, context);
    await fs.writeFile(path, input.content, "utf8");

    return {
      path,
      bytesWritten: Buffer.byteLength(input.content, "utf8"),
    };
  },
};
