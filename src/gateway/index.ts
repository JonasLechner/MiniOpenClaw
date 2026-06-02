import { initializeRuntime } from "../lib/runtime.js";
import { buildGateway } from "./app.js";
import { logGatewayListening } from "./log.js";

export async function main(): Promise<void> {
  const runtime = initializeRuntime();
  const app = buildGateway(runtime);

  const address = await app.listen({
    port: runtime.config.gateway.port,
    host: runtime.config.gateway.host,
  });
  logGatewayListening(address);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
