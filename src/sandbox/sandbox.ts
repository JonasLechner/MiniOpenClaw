export interface SandboxExecOptions {
  timeout?: number;
  signal?: AbortSignal;
}

export interface SandboxExecResult {
  output: string;
}

export interface Sandbox {
  ensure(): Promise<void>;
  exec(command: string, options?: SandboxExecOptions): Promise<SandboxExecResult>;
  dispose?(mode?: "stop" | "remove"): Promise<void>;
}

import { createHash } from "node:crypto";

export interface SandboxFactory {
  create(sessionId: string, workspacePath: string): Sandbox;
}

export function getSharedSandboxId(workspacePath: string): string {
  return `shared-${createHash("sha256").update(workspacePath).digest("hex").slice(0, 12)}`;
}

export type SandboxEngineKind = "auto" | "docker" | "podman";

export type SandboxNetworkMode = "none" | "default";

export interface SandboxConfig {
  enabled: boolean;
  engine: SandboxEngineKind;
  image: string;
  network: SandboxNetworkMode;
  memoryMb?: number;
  cpus?: number;
  pidsLimit?: number;
}
