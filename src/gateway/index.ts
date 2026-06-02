import { checkAuthAvailable } from "../agent/auth.js";
import { createLogger } from "../core/log.js";
import { initializeRuntime, type RuntimeState } from "../core/runtime.js";
import { ensureCurrentSession } from "../core/sessions.js";
import { createSandboxFactory, resolveSandboxEngineKind } from "../sandbox/factory.js";
import { buildGateway } from "./app.js";
import {
  logGatewayAuthWarning,
  logGatewayListening,
  logGatewaySandboxError,
  logGatewaySandboxReady,
  logGatewaySandboxStart,
} from "./log.js";

async function launchGatewaySandbox(runtime: RuntimeState): Promise<void> {
  const session = await ensureCurrentSession(runtime.paths);
  const resolvedEngineKind = await resolveSandboxEngineKind(runtime.config.sandbox);
  const engineLabel = resolvedEngineKind ?? "host";
  const image = runtime.config.sandbox.enabled ? runtime.config.sandbox.image : undefined;
  const startedAt = Date.now();

  logGatewaySandboxStart(session.sessionId, engineLabel, image);

  try {
    const sandboxFactory = await createSandboxFactory(runtime.config.sandbox, resolvedEngineKind);
    const sandbox = sandboxFactory.create(session.sessionId, runtime.paths.workspace);
    await sandbox.ensure();
    logGatewaySandboxReady(session.sessionId, engineLabel, Date.now() - startedAt, image);
  } catch (error) {
    const resolvedError = error instanceof Error ? error : new Error(String(error));
    logGatewaySandboxError(session.sessionId, engineLabel, Date.now() - startedAt, resolvedError, image);
    throw resolvedError;
  }
}

const logger = createLogger({ component: "gateway" });

export async function main(): Promise<void> {
  const runtime = initializeRuntime();
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

main().catch((error) => {
  const resolvedError = error instanceof Error ? error : new Error(String(error));
  logger.error("gateway_start_failed", { message: resolvedError.message, error: resolvedError });
  process.exit(1);
});
