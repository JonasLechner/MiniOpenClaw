import { createLogger } from "../core/log.js";
import type { RuntimeState } from "../core/runtime.js";
import { createSandboxFactory, resolveSandboxEngineKind } from "./factory.js";
import { getSharedSandboxId } from "./sandbox.js";

export async function launchStartupSandbox(runtime: RuntimeState, component: string): Promise<void> {
  const logger = createLogger({ component });
  const resolvedEngineKind = await resolveSandboxEngineKind(runtime.config.sandbox);
  const engine = resolvedEngineKind ?? "host";
  const image = runtime.config.sandbox.enabled ? runtime.config.sandbox.image : undefined;
  const startedAt = Date.now();

  logger.info("sandbox_starting", { engine, image });

  try {
    const sandboxFactory = await createSandboxFactory(runtime.config.sandbox, resolvedEngineKind);
    const sandbox = sandboxFactory.create(getSharedSandboxId(runtime.paths.workspace), runtime.paths.workspace);
    await sandbox.ensure();
    logger.info("sandbox_ready", { engine, image, durationMs: Date.now() - startedAt });
  } catch (error) {
    const resolvedError = error instanceof Error ? error : new Error(String(error));
    logger.error("sandbox_failed", { engine, image, durationMs: Date.now() - startedAt, message: resolvedError.message, error: resolvedError });
    throw resolvedError;
  }
}
