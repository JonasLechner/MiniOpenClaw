export type ContainerEngineKind = "docker" | "podman";

export interface ContainerRunOptions {
  name: string;
  image: string;
  workspacePath: string;
  workdir: string;
  command: string[];
  network: "none" | "default";
  memoryMb?: number;
  cpus?: number;
  pidsLimit?: number;
  env?: Record<string, string>;
}

export interface ContainerExecOptions {
  command: string;
  workdir?: string;
  timeout?: number;
}

export interface ContainerInspectResult {
  exists: boolean;
  running: boolean;
}

export interface ContainerEngine {
  runContainer(options: ContainerRunOptions): Promise<void>;
  startContainer(containerName: string): Promise<void>;
  execContainer(containerName: string, options: ContainerExecOptions): Promise<{ output: string }>;
  inspectContainer(containerName: string): Promise<ContainerInspectResult>;
  stopContainer(containerName: string): Promise<void>;
  removeContainer(containerName: string): Promise<void>;
}
