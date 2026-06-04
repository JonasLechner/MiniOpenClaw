import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRuntimeConfig, updateUserConfig } from "./core/config.js";

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const command = argv[0];
  const runtime = loadRuntimeConfig();

  if (command === "disable") {
    updateUserConfig(runtime.paths.configFile, (config) => ({
      ...config,
      sandbox: {
        ...config.sandbox,
        enabled: false,
      },
    }));
    console.log(`Sandboxing disabled in ${runtime.paths.configFile}`);
    return;
  }

  if (command === "enable") {
    updateUserConfig(runtime.paths.configFile, (config) => ({
      ...config,
      sandbox: {
        ...config.sandbox,
        enabled: true,
      },
    }));
    console.log(`Sandboxing enabled in ${runtime.paths.configFile}`);
    return;
  }

  throw new Error("Usage: sandbox-cli <disable|enable>");
}

const isEntrypoint = basename(process.argv[1] ?? "") === basename(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
