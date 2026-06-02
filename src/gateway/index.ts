import { initializeRuntime, type RuntimeState } from "../core/runtime.js";
import { ensureCurrentSession } from "../core/sessions.js";
import { createSandboxFactory, resolveSandboxEngineKind } from "../sandbox/factory.js";
import { buildGateway } from "./app.js";
import {
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

export async function main(): Promise<void> {
  const runtime = initializeRuntime();
  await launchGatewaySandbox(runtime);
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
