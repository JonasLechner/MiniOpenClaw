import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ContainerEngine,
  ContainerExecOptions,
  ContainerInspectResult,
  ContainerRunOptions,
} from "../container-engine.js";

interface ProcessResult {
  code: number | null;
  output: string;
  timedOut: boolean;
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(MODULE_DIR, "../../..");
const DEFAULT_SANDBOX_IMAGE = "miniopenclaw-sandbox:local";
const DEFAULT_SANDBOX_DOCKERFILE = resolve(REPOSITORY_ROOT, "docker", "sandbox.Dockerfile");

function runProcess(command: string, args: string[], timeout?: number): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let timedOut = false;
    let timeoutHandle: NodeJS.Timeout | undefined;

    child.stdout.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
    });

    child.on("error", (error) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      reject(error);
    });

    if (timeout !== undefined) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeout * 1000);
    }

    child.on("close", (code) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      resolve({ code, output, timedOut });
    });
  });
}

async function runChecked(command: string, args: string[], timeout?: number): Promise<string> {
  const result = await runProcess(command, args, timeout);

  if (result.timedOut) {
    throw new Error(`Command timed out after ${timeout} seconds\n\n${result.output}`.trimEnd());
  }

  if (result.code !== 0) {
    throw new Error(`${result.output}${result.output ? "\n\n" : ""}Command exited with code ${result.code}`);
  }

  return result.output;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureImageAvailable(binary: string, image: string): Promise<string> {
  if (image !== DEFAULT_SANDBOX_IMAGE) {
    return image;
  }

  if (!(await pathExists(DEFAULT_SANDBOX_DOCKERFILE))) {
    return image;
  }

  const inspect = await runProcess(binary, ["image", "inspect", image]);
  if (inspect.code === 0) {
    return image;
  }

  await runChecked(binary, [
    "build",
    "--tag",
    image,
    "--file",
    DEFAULT_SANDBOX_DOCKERFILE,
    REPOSITORY_ROOT,
  ]);

  return image;
}

export class CliContainerEngine implements ContainerEngine {
  readonly #binary: string;

  constructor(binary: string) {
    this.#binary = binary;
  }

  async runContainer(options: ContainerRunOptions): Promise<void> {
    const image = await ensureImageAvailable(this.#binary, options.image);
    const args = [
      "run",
      "--detach",
      "--name",
      options.name,
      "--workdir",
      options.workdir,
      "--mount",
      `type=bind,src=${options.workspacePath},dst=/workspace`,
      "--cap-drop=ALL",
      "--security-opt",
      "no-new-privileges",
    ];

    if (options.network === "none") {
      args.push("--network=none");
    }

    if (options.memoryMb !== undefined) {
      args.push(`--memory=${options.memoryMb}m`);
    }

    if (options.cpus !== undefined) {
      args.push(`--cpus=${String(options.cpus)}`);
    }

    if (options.pidsLimit !== undefined) {
      args.push(`--pids-limit=${options.pidsLimit}`);
    }

    for (const [key, value] of Object.entries(options.env ?? {})) {
      args.push("--env", `${key}=${value}`);
    }

    args.push(image, ...options.command);
    await runChecked(this.#binary, args);
  }

  async startContainer(containerName: string): Promise<void> {
    await runChecked(this.#binary, ["start", containerName]);
  }

  async execContainer(containerName: string, options: ContainerExecOptions): Promise<{ output: string }> {
    const args = ["exec"];

    if (options.workdir) {
      args.push("--workdir", options.workdir);
    }

    args.push(containerName, "bash", "-lc", options.command);

    return {
      output: await runChecked(this.#binary, args, options.timeout),
    };
  }

  async inspectContainer(containerName: string): Promise<ContainerInspectResult> {
    const result = await runProcess(this.#binary, ["inspect", "-f", "{{.State.Running}}", containerName]);

    if (result.code !== 0) {
      return { exists: false, running: false };
    }

    return {
      exists: true,
      running: result.output.trim() === "true",
    };
  }

  async stopContainer(containerName: string): Promise<void> {
    const state = await this.inspectContainer(containerName);
    if (!state.exists || !state.running) {
      return;
    }

    const result = await runProcess(this.#binary, ["stop", containerName]);
    if (result.code === 0) {
      return;
    }

    const updatedState = await this.inspectContainer(containerName);
    if (!updatedState.exists || !updatedState.running) {
      return;
    }

    throw new Error(`${result.output}${result.output ? "\n\n" : ""}Command exited with code ${result.code}`);
  }

  async removeContainer(containerName: string): Promise<void> {
    const state = await this.inspectContainer(containerName);
    if (!state.exists) {
      return;
    }

    const result = await runProcess(this.#binary, ["rm", "-f", containerName]);
    if (result.code === 0) {
      return;
    }

    const updatedState = await this.inspectContainer(containerName);
    if (!updatedState.exists) {
      return;
    }

    throw new Error(`${result.output}${result.output ? "\n\n" : ""}Command exited with code ${result.code}`);
  }
}

export class DockerEngine extends CliContainerEngine {
  constructor() {
    super("docker");
  }
}
