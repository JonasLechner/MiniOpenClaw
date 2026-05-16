import { webFetchTool } from "../src/agent/tools/index.js";

async function main(): Promise<void> {
  const result = await webFetchTool.run({
    url: "https://example.com",
    format: "text",
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
