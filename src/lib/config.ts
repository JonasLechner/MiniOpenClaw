import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import type { SandboxConfig } from "./sandbox.js";

export type UserConfig = {
  workspacePath?: string;
  gateway?: {
    host?: string;
    port?: number;
  };
  agent?: {
    provider?: string;
    modelId?: string;
    reasoning?: string;
  };
  sandbox?: {
    enabled?: boolean;
    engine?: SandboxConfig["engine"];
    image?: string;
    network?: SandboxConfig["network"];
    memoryMb?: number;
    cpus?: number;
    pidsLimit?: number;
  };
};

export type ResolvedConfig = {
  workspacePath?: string;
  gateway: {
    host: string;
    port: number;
  };
  agent: {
    provider?: string;
    modelId?: string;
    reasoning?: string;
  };
  sandbox: SandboxConfig;
};

export type RuntimePaths = {
  home: string;
  configFile: string;
  authFile: string;
  sessions: string;
  workspace: string;
  memory: string;
};

export type RuntimeConfig = {
  config: ResolvedConfig;
  paths: RuntimePaths;
};

const runtimeHome = join(homedir(), ".mini-openclaw");
const configFile = join(runtimeHome, "config.json");
const authFile = join(runtimeHome, "auth.json");
const defaultWorkspace = join(runtimeHome, "workspace");
const DEFAULT_SANDBOX_IMAGE = "miniopenclaw-sandbox:local";
const defaultConfig: UserConfig = {
  gateway: {
    host: "127.0.0.1",
    port: 3000,
  },
  agent: {},
  sandbox: {
    enabled: true,
    engine: "auto",
    image: DEFAULT_SANDBOX_IMAGE,
    network: "none",
  },
};

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function ensureJsonFile(path: string, defaultValue: object): void {
  if (existsSync(path)) return;

  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(defaultValue, null, 2)}\n`, "utf8");
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function parseConfig(path: string): ResolvedConfig {
  ensureJsonFile(path, defaultConfig);

  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid config file at ${path}: expected a JSON object.`);
  }

  const config = parsed as Record<string, unknown>;
  const gateway = (config.gateway ?? {}) as Record<string, unknown>;
  const agent = (config.agent ?? {}) as Record<string, unknown>;
  const sandbox = (config.sandbox ?? {}) as Record<string, unknown>;

  if (config.workspacePath !== undefined && typeof config.workspacePath !== "string") {
    throw new Error(`Invalid config file at ${path}: workspacePath must be a string.`);
  }

  if (config.gateway !== undefined && (typeof config.gateway !== "object" || Array.isArray(config.gateway))) {
    throw new Error(`Invalid config file at ${path}: gateway must be an object.`);
  }

  if (gateway.host !== undefined && typeof gateway.host !== "string") {
    throw new Error(`Invalid config file at ${path}: gateway.host must be a string.`);
  }

  if (gateway.port !== undefined && !isPositiveInteger(gateway.port)) {
    throw new Error(`Invalid config file at ${path}: gateway.port must be a positive integer.`);
  }

  if (config.agent !== undefined && (typeof config.agent !== "object" || Array.isArray(config.agent))) {
    throw new Error(`Invalid config file at ${path}: agent must be an object.`);
  }

  if (config.sandbox !== undefined && (typeof config.sandbox !== "object" || Array.isArray(config.sandbox))) {
    throw new Error(`Invalid config file at ${path}: sandbox must be an object.`);
  }

  if (agent.provider !== undefined && typeof agent.provider !== "string") {
    throw new Error(`Invalid config file at ${path}: agent.provider must be a string.`);
  }

  if (agent.modelId !== undefined && typeof agent.modelId !== "string") {
    throw new Error(`Invalid config file at ${path}: agent.modelId must be a string.`);
  }

  if (agent.reasoning !== undefined && typeof agent.reasoning !== "string") {
    throw new Error(`Invalid config file at ${path}: agent.reasoning must be a string.`);
  }

  if (sandbox.enabled !== undefined && typeof sandbox.enabled !== "boolean") {
    throw new Error(`Invalid config file at ${path}: sandbox.enabled must be a boolean.`);
  }

  if (sandbox.engine !== undefined && sandbox.engine !== "auto" && sandbox.engine !== "docker" && sandbox.engine !== "podman") {
    throw new Error(`Invalid config file at ${path}: sandbox.engine must be one of auto, docker, or podman.`);
  }

  if (sandbox.image !== undefined && typeof sandbox.image !== "string") {
    throw new Error(`Invalid config file at ${path}: sandbox.image must be a string.`);
  }

  if (sandbox.network !== undefined && sandbox.network !== "none" && sandbox.network !== "default") {
    throw new Error(`Invalid config file at ${path}: sandbox.network must be none or default.`);
  }

  if (sandbox.memoryMb !== undefined && !isPositiveInteger(sandbox.memoryMb)) {
    throw new Error(`Invalid config file at ${path}: sandbox.memoryMb must be a positive integer.`);
  }

  if (sandbox.cpus !== undefined && !isPositiveNumber(sandbox.cpus)) {
    throw new Error(`Invalid config file at ${path}: sandbox.cpus must be a positive number.`);
  }

  if (sandbox.pidsLimit !== undefined && !isPositiveInteger(sandbox.pidsLimit)) {
    throw new Error(`Invalid config file at ${path}: sandbox.pidsLimit must be a positive integer.`);
  }

  return {
    workspacePath: config.workspacePath as string | undefined,
    gateway: {
      host: (gateway.host as string | undefined) ?? defaultConfig.gateway!.host!,
      port: (gateway.port as number | undefined) ?? defaultConfig.gateway!.port!,
    },
    agent: {
      provider: agent.provider as string | undefined,
      modelId: agent.modelId as string | undefined,
      reasoning: agent.reasoning as string | undefined,
    },
    sandbox: {
      enabled: (sandbox.enabled as boolean | undefined) ?? defaultConfig.sandbox!.enabled!,
      engine: (sandbox.engine as SandboxConfig["engine"] | undefined) ?? defaultConfig.sandbox!.engine!,
      image: (sandbox.image as string | undefined) ?? defaultConfig.sandbox!.image!,
      network: (sandbox.network as SandboxConfig["network"] | undefined) ?? defaultConfig.sandbox!.network!,
      memoryMb: sandbox.memoryMb as number | undefined,
      cpus: sandbox.cpus as number | undefined,
      pidsLimit: sandbox.pidsLimit as number | undefined,
    },
  };
}

function resolveWorkspacePath(config: ResolvedConfig): string {
  if (!config.workspacePath) return defaultWorkspace;

  return isAbsolute(config.workspacePath)
    ? config.workspacePath
    : resolve(runtimeHome, config.workspacePath);
}

export async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export function loadRuntimeConfig(): RuntimeConfig {
  ensureDir(runtimeHome);

  const config = parseConfig(configFile);
  const workspace = resolveWorkspacePath(config);
  const paths: RuntimePaths = {
    home: runtimeHome,
    configFile,
    authFile,
    sessions: join(runtimeHome, "sessions"),
    workspace,
    memory: join(workspace, "memory"),
  };

  return { config, paths };
}
