import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkAuthAvailable } from "../agent/auth.js";
import { configureLogFile, createLogger } from "../core/log.js";
import { needsOnboarding } from "../core/onboarding.js";
import { initializeRuntime, type RuntimeState } from "../core/runtime.js";
import { ensureCurrentSession } from "../core/sessions.js";
import { createSandboxFactory, resolveSandboxEngineKind } from "../sandbox/factory.js";
import { getSharedSandboxId } from "../sandbox/sandbox.js";
import { buildGateway } from "./app.js";
import {
  logGatewayAuthWarning,
  logGatewayListening,
  logGatewaySandboxError,
  logGatewaySandboxReady,
  logGatewaySandboxStart,
} from "./log.js";

async function launchGatewaySandbox(runtime: RuntimeState): Promise<void> {
  const session = await ensureCurrentSession(runtime.paths, "gateway");
  const resolvedEngineKind = await resolveSandboxEngineKind(runtime.config.sandbox);
  const engineLabel = resolvedEngineKind ?? "host";
  const image = runtime.config.sandbox.enabled ? runtime.config.sandbox.image : undefined;
  const startedAt = Date.now();

  logGatewaySandboxStart(session.sessionId, engineLabel, image);

  try {
    const sandboxFactory = await createSandboxFactory(runtime.config.sandbox, resolvedEngineKind);
    const sandbox = sandboxFactory.create(getSharedSandboxId(runtime.paths.workspace), runtime.paths.workspace);
    await sandbox.ensure();
    logGatewaySandboxReady(session.sessionId, engineLabel, Date.now() - startedAt, image);
  } catch (error) {
    const resolvedError = error instanceof Error ? error : new Error(String(error));
    logGatewaySandboxError(session.sessionId, engineLabel, Date.now() - startedAt, resolvedError, image);
    throw resolvedError;
  }
}

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
  await launchGatewaySandbox(runtime);

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
