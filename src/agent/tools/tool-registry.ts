import type { Tool as PiTool } from "@earendil-works/pi-ai";
import { toPiTool, type ToolDefinition } from "./types.js";

export { bashTool } from "./bash.js";
export { cronjobTool } from "./cronjob.js";
export { editTool } from "./edit.js";
export { globTool } from "./glob.js";
export { grepTool } from "./grep.js";
export { readTool } from "./read.js";
export { subagentTool } from "./subagent.js";
export { webFetchTool } from "./webfetch.js";
export { webSearchTool } from "./websearch.js";
export { writeTool } from "./write.js";

import { bashTool } from "./bash.js";
import { cronjobTool } from "./cronjob.js";
import { editTool } from "./edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { readTool } from "./read.js";
import { subagentTool } from "./subagent.js";
import { webFetchTool } from "./webfetch.js";
import { webSearchTool } from "./websearch.js";
import { writeTool } from "./write.js";

const registeredTools = [readTool, writeTool, editTool, grepTool, globTool, bashTool, cronjobTool, subagentTool, webSearchTool, webFetchTool] as const;

type RegisteredTool = (typeof registeredTools)[number] | ToolDefinition<unknown, unknown>;

export type ToolRegistry = {
  exposedTools: PiTool[];
  toolMap: Record<string, ToolDefinition<unknown, unknown>>;
  registeredTools: readonly RegisteredTool[];
};

export function createToolRegistry(tools: readonly RegisteredTool[] = registeredTools): ToolRegistry {
  return {
    registeredTools: tools,
    exposedTools: tools.map((tool) => toPiTool(tool)),
    toolMap: Object.fromEntries(tools.map((tool) => [tool.name, tool])),
  };
}

export const toolRegistry = createToolRegistry();
export const exposedTools = toolRegistry.exposedTools;
export const toolMap = toolRegistry.toolMap;

export function getRegisteredTools(): readonly RegisteredTool[] {
  return registeredTools;
}
