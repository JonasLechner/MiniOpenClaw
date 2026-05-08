import { initializeRuntime } from "../lib/runtime.js";
import { buildGateway } from "./app.js";

export async function main(): Promise<void> {
  const runtime = initializeRuntime();
  const app = buildGateway();

  await app.listen({
    port: runtime.config.gateway?.port ?? 3000,
    host: runtime.config.gateway?.host ?? "127.0.0.1",
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
