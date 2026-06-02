import { readTool, writeTool } from "../src/agent/tools/index.js";
import { HostSandbox } from "../src/lib/sandbox/host-sandbox.js";

const toolContext = (workspacePath: string) => ({ workspacePath, sandbox: new HostSandbox(workspacePath) });

async function main(): Promise<void> {
  const writeResult = await writeTool.run({
    path: "examples/generated.txt",
    content: "Generated line 1\nGenerated line 2\nGenerated line 3\n",
  }, toolContext(process.cwd()));

  console.log(`Wrote ${writeResult.bytesWritten} bytes to ${writeResult.path}`);

  const generatedSecondLine = await readTool.run({
    path: "examples/generated.txt",
    startLine: 2,
    endLine: 2,
  }, toolContext(process.cwd()));

  console.log(generatedSecondLine);

  const content = await readTool.run({
    path: "examples/hello.txt",
    startLine: 2,
    endLine: 4,
  }, toolContext(process.cwd()));

  console.log(content);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
