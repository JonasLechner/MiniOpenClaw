import type { ContainerEngine } from "../container-engine.js";
import type { Sandbox, SandboxConfig, SandboxExecOptions, SandboxExecResult } from "../sandbox.js";

const WORKSPACE_MOUNT_PATH = "/workspace";

function toContainerName(sessionId: string): string {
  const sanitized = sessionId.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  return `miniopenclaw-${sanitized || "session"}`;
}

export class ContainerSandbox implements Sandbox {
  readonly #engine: ContainerEngine;
  readonly #config: SandboxConfig;
  readonly #workspacePath: string;
  readonly #containerName: string;

  constructor(engine: ContainerEngine, sessionId: string, workspacePath: string, config: SandboxConfig) {
    this.#engine = engine;
    this.#config = config;
    this.#workspacePath = workspacePath;
    this.#containerName = toContainerName(sessionId);
  }

  async ensure(): Promise<void> {
    const state = await this.#engine.inspectContainer(this.#containerName);

    if (!state.exists) {
      await this.#engine.runContainer({
        name: this.#containerName,
        image: this.#config.image,
        workspacePath: this.#workspacePath,
        workdir: WORKSPACE_MOUNT_PATH,
        command: ["sleep", "infinity"],
        network: this.#config.network,
        memoryMb: this.#config.memoryMb,
        cpus: this.#config.cpus,
        pidsLimit: this.#config.pidsLimit,
        env: {
          HOME: "/tmp/miniopenclaw",
          PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        },
      });
      return;
    }

    if (!state.running) {
      await this.#engine.startContainer(this.#containerName);
    }
  }

  async exec(command: string, options?: SandboxExecOptions): Promise<SandboxExecResult> {
    await this.ensure();
    return this.#engine.execContainer(this.#containerName, {
      command,
      workdir: WORKSPACE_MOUNT_PATH,
      timeout: options?.timeout,
    });
  }

  async dispose(mode: "stop" | "remove" = "remove"): Promise<void> {
    if (mode === "remove") {
      await this.#engine.removeContainer(this.#containerName);
      return;
    }

    await this.#engine.stopContainer(this.#containerName);
  }
}
