export interface Tool<Input, Output> {
  name: string;
  run(input: Input): Promise<Output>;
}
