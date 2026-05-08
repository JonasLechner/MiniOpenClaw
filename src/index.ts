import { readTool } from "./tools";

async function main(): Promise<void> {
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
