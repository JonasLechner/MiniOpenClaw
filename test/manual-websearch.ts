import { webSearchTool } from "../src/agent/tools/tool-registry.js";

async function main(): Promise<void> {
  const result = await webSearchTool.run({
    query: "TypeScript file reading",
    limit: 3,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
