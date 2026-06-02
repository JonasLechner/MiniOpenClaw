import { initializeRuntime } from "../lib/runtime.js";
import { buildGateway } from "./app.js";

export async function main(): Promise<void> {
  const runtime = initializeRuntime();
  const app = buildGateway(runtime);

  await app.listen({
    port: runtime.config.gateway.port,
    host: runtime.config.gateway.host,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
