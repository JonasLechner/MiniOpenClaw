import type { ContainerEngine, ContainerEngineKind } from "../container-engine.js";
import type { Sandbox, SandboxConfig, SandboxFactory } from "../sandbox.js";
import { resolveContainerEngine, resolveContainerEngineKind } from "../container-engine/resolve.js";
import { ContainerSandbox } from "./container-sandbox.js";
import { HostSandbox } from "./host-sandbox.js";

class HostSandboxFactory implements SandboxFactory {
  create(_sessionId: string, workspacePath: string): Sandbox {
    return new HostSandbox(workspacePath);
  }
}

class ConfiguredContainerSandboxFactory implements SandboxFactory {
  readonly #config: SandboxConfig;
  readonly #engine: ContainerEngine;

  constructor(config: SandboxConfig, engine: ContainerEngine) {
    this.#config = config;
    this.#engine = engine;
  }

  create(sessionId: string, workspacePath: string): Sandbox {
    return new ContainerSandbox(this.#engine, sessionId, workspacePath, this.#config);
  }
}

export async function resolveSandboxEngineKind(config: SandboxConfig): Promise<ContainerEngineKind | undefined> {
  if (!config.enabled) {
    return undefined;
  }

  return resolveContainerEngineKind(config.engine);
}

export async function createSandboxFactory(
  config: SandboxConfig,
  resolvedEngineKind?: ContainerEngineKind,
): Promise<SandboxFactory> {
  if (!config.enabled) {
    return new HostSandboxFactory();
  }

  const engine = await resolveContainerEngine(resolvedEngineKind ?? config.engine);
  return new ConfiguredContainerSandboxFactory(config, engine);
}
