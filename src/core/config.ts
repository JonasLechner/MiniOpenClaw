import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import type { SandboxConfig } from "../sandbox/sandbox.js";
import type { LogLevel } from "./log.js";

export type UserConfig = {
  workspacePath?: string;
  gateway?: {
    host?: string;
    port?: number;
    telegram?: {
      enabled?: boolean;
      token?: string;
      polling?: boolean;
      allowedUserIds?: string[];
    };
  };
  agent?: {
    provider?: string;
    modelId?: string;
    reasoning?: string;
    availableModels?: Record<string, string[]>;
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
  logging?: {
    level?: LogLevel;
  };
};

export type ResolvedConfig = {
  workspacePath?: string;
  gateway: {
    host: string;
    port: number;
    telegram: {
      enabled: boolean;
      token?: string;
      polling: boolean;
      allowedUserIds: string[];
    };
  };
  agent: {
    provider?: string;
    modelId?: string;
    reasoning?: string;
    availableModels?: Record<string, string[]>;
  };
  sandbox: SandboxConfig;
  logging: {
    level: LogLevel;
  };
};

export type RuntimePaths = {
  home: string;
  configFile: string;
  authFile: string;
  onboardingState: string;
  sessions: string;
  workspace: string;
  memory: string;
  conversationBindings: string;
  scheduledTasks: string;
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
    telegram: {
      enabled: false,
      polling: true,
      allowedUserIds: [],
    },
  },
  agent: {},
  sandbox: {
    enabled: true,
    engine: "auto",
    image: DEFAULT_SANDBOX_IMAGE,
    network: "none",
  },
  logging: {
    level: "info",
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

export function writeUserConfig(path: string, config: UserConfig): void {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function updateUserConfig(path: string, updater: (config: UserConfig) => UserConfig): UserConfig {
  ensureJsonFile(path, defaultConfig);
  const current = JSON.parse(readFileSync(path, "utf8")) as UserConfig;
  const next = updater(current);
  writeUserConfig(path, next);
  return next;
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
  const logging = (config.logging ?? {}) as Record<string, unknown>;
  const telegram = (gateway.telegram ?? {}) as Record<string, unknown>;

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

  if (gateway.telegram !== undefined && (typeof gateway.telegram !== "object" || Array.isArray(gateway.telegram))) {
    throw new Error(`Invalid config file at ${path}: gateway.telegram must be an object.`);
  }

  if (telegram.enabled !== undefined && typeof telegram.enabled !== "boolean") {
    throw new Error(`Invalid config file at ${path}: gateway.telegram.enabled must be a boolean.`);
  }

  if (telegram.token !== undefined && typeof telegram.token !== "string") {
    throw new Error(`Invalid config file at ${path}: gateway.telegram.token must be a string.`);
  }

  if (telegram.polling !== undefined && typeof telegram.polling !== "boolean") {
    throw new Error(`Invalid config file at ${path}: gateway.telegram.polling must be a boolean.`);
  }

  if (
    telegram.allowedUserIds !== undefined
    && (!Array.isArray(telegram.allowedUserIds) || telegram.allowedUserIds.some((value) => typeof value !== "string"))
  ) {
    throw new Error(`Invalid config file at ${path}: gateway.telegram.allowedUserIds must be an array of strings.`);
  }

  if (config.agent !== undefined && (typeof config.agent !== "object" || Array.isArray(config.agent))) {
    throw new Error(`Invalid config file at ${path}: agent must be an object.`);
  }

  if (config.sandbox !== undefined && (typeof config.sandbox !== "object" || Array.isArray(config.sandbox))) {
    throw new Error(`Invalid config file at ${path}: sandbox must be an object.`);
  }

  if (config.logging !== undefined && (!config.logging || typeof config.logging !== "object" || Array.isArray(config.logging))) {
    throw new Error(`Invalid config file at ${path}: logging must be an object.`);
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

  if (agent.availableModels !== undefined) {
    if (typeof agent.availableModels !== "object" || Array.isArray(agent.availableModels) || agent.availableModels === null) {
      throw new Error(`Invalid config file at ${path}: agent.availableModels must be an object mapping provider ids to arrays of model ids.`);
    }

    for (const [providerId, modelIds] of Object.entries(agent.availableModels)) {
      if (!Array.isArray(modelIds) || modelIds.some((value) => typeof value !== "string")) {
        throw new Error(`Invalid config file at ${path}: agent.availableModels.${providerId} must be an array of strings.`);
      }
    }
  }

  const availableModels = agent.availableModels as Record<string, string[]> | undefined;

  if (agent.provider !== undefined && availableModels !== undefined && !(agent.provider in availableModels)) {
    throw new Error(`Invalid config file at ${path}: agent.provider must be a key in agent.availableModels.`);
  }

  if (
    agent.provider !== undefined
    && agent.modelId !== undefined
    && availableModels !== undefined
    && agent.provider in availableModels
    && !availableModels[agent.provider].includes(agent.modelId)
  ) {
    throw new Error(`Invalid config file at ${path}: agent.modelId must be listed in agent.availableModels.${agent.provider}.`);
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

  if (logging.level !== undefined && logging.level !== "debug" && logging.level !== "info" && logging.level !== "warn" && logging.level !== "error") {
    throw new Error(`Invalid config file at ${path}: logging.level must be one of debug, info, warn, or error.`);
  }

  return {
    workspacePath: config.workspacePath as string | undefined,
    gateway: {
      host: (gateway.host as string | undefined) ?? defaultConfig.gateway!.host!,
      port: (gateway.port as number | undefined) ?? defaultConfig.gateway!.port!,
      telegram: {
        enabled: (telegram.enabled as boolean | undefined) ?? defaultConfig.gateway!.telegram!.enabled!,
        token: telegram.token as string | undefined,
        polling: (telegram.polling as boolean | undefined) ?? defaultConfig.gateway!.telegram!.polling!,
        allowedUserIds: (telegram.allowedUserIds as string[] | undefined) ?? defaultConfig.gateway!.telegram!.allowedUserIds!,
      },
    },
    agent: {
      provider: agent.provider as string | undefined,
      modelId: agent.modelId as string | undefined,
      reasoning: agent.reasoning as string | undefined,
      availableModels: agent.availableModels as Record<string, string[]> | undefined,
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
    logging: {
      level: (logging.level as LogLevel | undefined) ?? defaultConfig.logging!.level!,
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
    onboardingState: join(runtimeHome, "onboarding.json"),
    sessions: join(runtimeHome, "sessions"),
    workspace,
    memory: join(workspace, "memory"),
    conversationBindings: join(runtimeHome, "conversation-bindings.json"),
    scheduledTasks: join(runtimeHome, "scheduled-tasks.json"),
  };

  return { config, paths };
}
