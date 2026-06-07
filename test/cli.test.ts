import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeState } from "../src/core/runtime.js";

const initializeRuntimeMock = vi.fn<() => RuntimeState>();
const spawnSyncMock = vi.fn();
const runAuthMock = vi.fn<(argv: string[]) => Promise<void>>();
const runOnboardingMock = vi.fn<(runtime: RuntimeState) => Promise<void>>();
const getGatewayServiceStatusMock = vi.fn();
const startGatewayServiceMock = vi.fn();
const stopGatewayServiceMock = vi.fn();
const restartGatewayServiceMock = vi.fn();

vi.mock("../src/core/runtime.js", () => ({
  initializeRuntime: initializeRuntimeMock,
}));

vi.mock("node:child_process", () => ({
  spawnSync: spawnSyncMock,
}));

vi.mock("../src/auth-cli.js", () => ({
  main: runAuthMock,
}));

vi.mock("../src/onboarding/runner.js", () => ({
  runOnboarding: runOnboardingMock,
}));

vi.mock("../src/gateway/service.js", () => ({
  getGatewayServiceStatus: getGatewayServiceStatusMock,
  startGatewayService: startGatewayServiceMock,
  stopGatewayService: stopGatewayServiceMock,
  restartGatewayService: restartGatewayServiceMock,
}));

describe("miniopenclaw cli", () => {
  const runtime = {
    config: {
      gateway: { host: "127.0.0.1", port: 3000 },
    },
    paths: {
      home: "/tmp/.mini-openclaw",
    },
  } as RuntimeState;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    initializeRuntimeMock.mockReturnValue(runtime);
    spawnSyncMock.mockReturnValue({ status: 0 });
    getGatewayServiceStatusMock.mockResolvedValue({
      state: "stopped",
      healthy: false,
      paths: { stdoutLog: "/tmp/gateway.log", stderrLog: "/tmp/gateway.err.log", pidFile: "/tmp/gateway.pid" },
    });
    startGatewayServiceMock.mockResolvedValue({
      started: true,
      status: {
        state: "running",
        pid: 123,
        healthy: true,
        paths: { stdoutLog: "/tmp/gateway.log", stderrLog: "/tmp/gateway.err.log", pidFile: "/tmp/gateway.pid" },
      },
    });
    stopGatewayServiceMock.mockResolvedValue({
      stopped: true,
      status: {
        state: "stopped",
        healthy: false,
        paths: { stdoutLog: "/tmp/gateway.log", stderrLog: "/tmp/gateway.err.log", pidFile: "/tmp/gateway.pid" },
      },
    });
    restartGatewayServiceMock.mockResolvedValue({
      state: "running",
      pid: 124,
      healthy: true,
      paths: { stdoutLog: "/tmp/gateway.log", stderrLog: "/tmp/gateway.err.log", pidFile: "/tmp/gateway.pid" },
    });
  });

  it("opens the agent TUI by default via Bun", async () => {
    const { main } = await import("../src/cli.js");
    await main([]);
    expect(spawnSyncMock).toHaveBeenCalledOnce();
    expect(spawnSyncMock.mock.calls[0]?.[0]).toBe("bun");
  });

  it("routes auth arguments to the auth command", async () => {
    const { main } = await import("../src/cli.js");
    await main(["auth", "openai-codex"]);
    expect(runAuthMock).toHaveBeenCalledWith(["openai-codex"]);
  });

  it("runs onboarding", async () => {
    const { main } = await import("../src/cli.js");
    await main(["onboard"]);
    expect(runOnboardingMock).toHaveBeenCalledWith(runtime);
  });

  it("starts the gateway when requested", async () => {
    const { main } = await import("../src/cli.js");
    await main(["gateway"]);
    expect(startGatewayServiceMock).toHaveBeenCalledWith(runtime);
  });
});
