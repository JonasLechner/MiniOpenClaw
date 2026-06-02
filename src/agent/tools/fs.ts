import type { ToolRunContext } from "./types.js";
import { isWithinWorkspacePath } from "../../core/host-workspace.js";

export { isWithinWorkspacePath };

export async function resolveWorkspacePath(targetPath: string, context?: ToolRunContext): Promise<string> {
  if (!context) {
    throw new Error("tool context is required");
  }

  return context.workspace.resolvePath(targetPath);
}
