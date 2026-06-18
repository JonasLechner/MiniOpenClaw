import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkAuthAvailable } from "../agent/auth.js";
import { configureLogFile, createLogger } from "../core/log.js";
import { needsOnboarding } from "../core/onboarding.js";
import { initializeRuntime, type RuntimeState } from "../core/runtime.js";
import { launchStartupSandbox } from "../sandbox/startup.js";
import { buildGateway } from "./app.js";
import {
  logGatewayAuthWarning,
  logGatewayListening,
} from "./log.js";

const logger = createLogger({ component: "gateway" });

export function ensureGatewayOnboardingComplete(runtime: RuntimeState): void {
  if (!needsOnboarding(runtime.paths)) {
    return;
  }

  throw new Error("Onboarding is incomplete. Run npm run onboard to finish first-time setup before starting the gateway.");
}

export async function main(): Promise<void> {
  const runtime = initializeRuntime();
  configureLogFile(runtime.config.logging.file !== false ? join(runtime.paths.home, "gateway.log") : undefined);
  ensureGatewayOnboardingComplete(runtime);
  await launchStartupSandbox(runtime, "gateway");

  if (!checkAuthAvailable(runtime)) {
    const provider = runtime.config.agent.provider;
    if (!provider) {
      logger.warn("gateway_provider_missing", {
        message: "No agent provider configured. Set agent.provider and agent.modelId in ~/.mini-openclaw/config.json",
      });
    } else {
      logGatewayAuthWarning(provider, runtime.paths.authFile);
    }
  }

  const app = buildGateway(runtime);

  const address = await app.listen({
    port: runtime.config.gateway.port,
    host: runtime.config.gateway.host,
  });
  logGatewayListening(address);
}

const isEntrypoint = basename(process.argv[1] ?? "") === basename(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  main().catch((error) => {
    const resolvedError = error instanceof Error ? error : new Error(String(error));
    logger.error("gateway_start_failed", { message: resolvedError.message });
    process.exit(1);
  });
}
