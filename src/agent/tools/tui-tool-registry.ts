import { fullToolRegistry } from "./full-tool-registry.js";
import { createToolRegistry } from "./tool-registry.js";

export const tuiToolRegistry = createToolRegistry(
  fullToolRegistry.registeredTools.filter((tool) => tool.name !== "workspace_search"),
);
