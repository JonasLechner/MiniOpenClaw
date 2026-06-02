import type { Tool as PiTool } from "@earendil-works/pi-ai";

export interface ToolRunContext {
  workspacePath: string;
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
