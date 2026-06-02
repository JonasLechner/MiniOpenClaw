import { toPiTool, type ToolDefinition } from "./types.js";

export { bashTool } from "./bash.js";
export { cronjobTool } from "./cronjob.js";
export { editTool } from "./edit.js";
export { globTool } from "./glob.js";
export { grepTool } from "./grep.js";
export { readTool } from "./read.js";
export { webFetchTool } from "./webfetch.js";
export { webSearchTool } from "./websearch.js";
export { writeTool } from "./write.js";

import { bashTool } from "./bash.js";
import { cronjobTool } from "./cronjob.js";
import { editTool } from "./edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { readTool } from "./read.js";
import { webFetchTool } from "./webfetch.js";
import { webSearchTool } from "./websearch.js";
import { writeTool } from "./write.js";

const registeredTools = [readTool, writeTool, editTool, grepTool, globTool, bashTool, cronjobTool, webSearchTool, webFetchTool] as const;

type RegisteredTool = (typeof registeredTools)[number];

export const exposedTools = registeredTools.map((tool) => toPiTool(tool));

export const toolMap: Record<string, ToolDefinition<unknown, unknown>> = Object.fromEntries(
  registeredTools.map((tool) => [tool.name, tool]),
);

export function getRegisteredTools(): readonly RegisteredTool[] {
  return registeredTools;
}
