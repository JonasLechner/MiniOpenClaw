export interface ToolRunContext {
  workspacePath: string;
}

export interface Tool<Input, Output> {
  name: string;
  run(input: Input, context?: ToolRunContext): Promise<Output>;
}
