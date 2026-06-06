import { workspaceSearchTool } from "./workspace-search.js";
import { createToolRegistry, getRegisteredTools } from "./tool-registry.js";

export const fullToolRegistry = createToolRegistry([
  ...getRegisteredTools(),
  workspaceSearchTool,
]);
