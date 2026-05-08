import { readTool, writeTool } from "../src/tools";

async function main(): Promise<void> {
  const writeResult = await writeTool.run({
    path: "examples/generated.txt",
    content: "Generated line 1\nGenerated line 2\nGenerated line 3\n",
  });

  console.log(`Wrote ${writeResult.bytesWritten} bytes to ${writeResult.path}`);

  const generatedSecondLine = await readTool.run({
    path: "examples/generated.txt",
    startLine: 2,
    endLine: 2,
  });

  console.log(generatedSecondLine);

  const content = await readTool.run({
    path: "examples/hello.txt",
    startLine: 2,
    endLine: 4,
  });

  console.log(content);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
