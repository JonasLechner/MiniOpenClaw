import type { ImageContent, TextContent, Tool as PiTool } from "@earendil-works/pi-ai";
import type { Sandbox } from "../../sandbox/sandbox.js";
import type { Workspace } from "../../core/workspace.js";

export interface ToolRunContext {
  workspace: Workspace;
  sandbox: Sandbox;
  signal?: AbortSignal;
}

export function requireToolContext(context?: ToolRunContext): ToolRunContext {
  if (!context) {
    throw new Error("tool context is required");
  }

  return context;
}

export function requireSandbox(context?: ToolRunContext): Sandbox {
  return requireToolContext(context).sandbox;
}

export interface ToolRunResult<Details = unknown> {
  content: Array<TextContent | ImageContent>;
  details?: Details;
}

export function textToolResult<Details = unknown>(text: string, details?: Details): ToolRunResult<Details> {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

export interface ToolDefinition<Input, Output> {
  name: string;
  description: string;
  parameters: PiTool["parameters"];
  run(input: Input, context?: ToolRunContext): Promise<Output>;
}

export function toPiTool(tool: ToolDefinition<unknown, unknown>): PiTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}
