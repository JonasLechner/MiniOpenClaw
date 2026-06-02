import { describe, expect, it } from "vitest";
import { resolveContainerEngineKind } from "../src/lib/container-engine/resolve.js";

describe("resolveContainerEngineKind", () => {
  it("prefers Docker on Windows in auto mode", async () => {
    const resolved = await resolveContainerEngineKind("auto", "win32", async (binary) => binary === "docker");
    expect(resolved).toBe("docker");
  });

  it("prefers Podman on Linux in auto mode", async () => {
    const resolved = await resolveContainerEngineKind("auto", "linux", async () => true);
    expect(resolved).toBe("podman");
  });

  it("falls back to Docker on Linux when Podman is unavailable", async () => {
    const resolved = await resolveContainerEngineKind("auto", "linux", async (binary) => binary === "docker");
    expect(resolved).toBe("docker");
  });
});
