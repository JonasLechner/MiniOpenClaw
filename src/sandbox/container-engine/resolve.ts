import { spawn } from "node:child_process";
import type { ContainerEngine } from "../container-engine.js";
import type { SandboxEngineKind } from "../sandbox.js";
import { DockerEngine } from "./docker.js";
import { PodmanEngine } from "./podman.js";

export type EngineAvailabilityProbe = (binary: "docker" | "podman") => Promise<boolean>;

async function commandExists(binary: "docker" | "podman"): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(binary, ["version"], {
      stdio: "ignore",
    });

    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export async function resolveContainerEngineKind(
  engine: SandboxEngineKind,
  platform = process.platform,
  probe: EngineAvailabilityProbe = commandExists,
): Promise<"docker" | "podman"> {
  if (engine === "docker" || engine === "podman") {
    return engine;
  }

  const preferredOrder = platform === "win32"
    ? ["docker", "podman"] as const
    : ["podman", "docker"] as const;

  for (const candidate of preferredOrder) {
    if (await probe(candidate)) {
      return candidate;
    }
  }

  throw new Error("No supported container engine found. Install Docker or Podman, or disable sandboxing with `npm run sandbox:disable`.");
}

export async function resolveContainerEngine(
  engine: SandboxEngineKind,
  platform = process.platform,
  probe: EngineAvailabilityProbe = commandExists,
): Promise<ContainerEngine> {
  const resolvedKind = await resolveContainerEngineKind(engine, platform, probe);
  return resolvedKind === "podman" ? new PodmanEngine() : new DockerEngine();
}
