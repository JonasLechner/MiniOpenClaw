import { describe, expect, it, vi } from "vitest";
import { ContainerSandbox } from "../src/sandbox/container-sandbox.js";
import type { ContainerEngine } from "../src/sandbox/container-engine.js";
import type { SandboxConfig } from "../src/sandbox/sandbox.js";

const config: SandboxConfig = {
  enabled: true,
  engine: "docker",
  image: "miniopenclaw-sandbox:local",
  network: "none",
};

describe("ContainerSandbox abort handling", () => {
  it("does not stop the reusable session container when exec is aborted", async () => {
    const stopContainer = vi.fn(async () => {});
    const engine: ContainerEngine = {
      runContainer: vi.fn(async () => {}),
      startContainer: vi.fn(async () => {}),
      inspectContainer: vi.fn(async () => ({ exists: true, running: true })),
      stopContainer,
      removeContainer: vi.fn(async () => {}),
      execContainer: vi.fn(async (_containerName, options) => {
        await new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(new DOMException("Command aborted", "AbortError")), {
            once: true,
          });
        });
        return { output: "" };
      }),
    };
    const sandbox = new ContainerSandbox(engine, "session-1", "/workspace", config);
    const controller = new AbortController();

    const running = sandbox.exec("sleep 999", { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(running).rejects.toThrow("Command aborted");
    expect(stopContainer).not.toHaveBeenCalled();
  });
});
