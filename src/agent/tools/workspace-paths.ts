import type { ToolRunContext } from "./types.js";

export async function resolveWorkspacePath(targetPath: string, context?: ToolRunContext): Promise<string> {
  if (!context) {
    throw new Error("tool context is required");
  }

  return context.workspace.resolvePath(targetPath);
}
