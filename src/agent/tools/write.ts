import { Type } from "@earendil-works/pi-ai";
import { resolveWorkspacePath } from "./fs.js";
import { requireToolContext, type ToolDefinition } from "./types.js";

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
    const toolContext = requireToolContext(context);
    const path = await resolveWorkspacePath(input.path, toolContext);
    await toolContext.workspace.writeFile(input.path, input.content);

    return {
      path,
      bytesWritten: Buffer.byteLength(input.content, "utf8"),
    };
  },
};
