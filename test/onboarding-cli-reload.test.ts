import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { RuntimeState } from "../src/core/runtime.js";

const initializeRuntimeMock = vi.fn<() => RuntimeState>();
const needsOnboardingMock = vi.fn<(paths: RuntimeState["paths"]) => boolean>();
const runOnboardingMock = vi.fn<(runtime: RuntimeState) => Promise<void>>();
const agentCreateForSessionMock = vi.fn();
const launchStartupSandboxMock = vi.fn(async () => {});
const tuiStartMock = vi.fn(async () => {});

vi.mock("../src/core/runtime.js", () => ({
  initializeRuntime: initializeRuntimeMock,
}));

vi.mock("../src/core/onboarding.js", () => ({
  needsOnboarding: needsOnboardingMock,
}));

vi.mock("../src/onboarding/runner.js", () => ({
  runOnboarding: runOnboardingMock,
}));

vi.mock("../src/agent/agent.js", () => ({
  Agent: {
    createForSession: agentCreateForSessionMock,
  },
}));

vi.mock("../src/sandbox/startup.js", () => ({
  launchStartupSandbox: launchStartupSandboxMock,
}));

vi.mock("../src/agent/tui/app.js", () => ({
  TuiApp: class {
    async start() {
      await tuiStartMock();
    }
  },
}));

let root: string | undefined;
const originalIsTTY = process.stdin.isTTY;

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true });
    root = undefined;
  }
  Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
  vi.clearAllMocks();
  vi.resetModules();
});

test("agent CLI reloads runtime after onboarding before creating the agent", async () => {
  root = mkdtempSync(join(tmpdir(), "miniopenclaw-onboarding-cli-reload-"));
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

  const firstRuntime = {
    config: {} as never,
    paths: {
      home: root,
      configFile: join(root, "config.json"),
      authFile: join(root, "auth.json"),
      sessions: join(root, "sessions"),
      workspace: join(root, "workspace"),
      memory: join(root, "workspace", "memory"),
      conversationBindings: join(root, "conversation-bindings.json"),
      scheduledTasks: join(root, "scheduled-tasks.json"),
    },
  } as RuntimeState;

  const secondRuntime = {
    ...firstRuntime,
    config: { agent: { provider: "openai-codex", modelId: "gpt-5.4" } } as never,
  } as RuntimeState;

  initializeRuntimeMock.mockReturnValueOnce(firstRuntime).mockReturnValueOnce(secondRuntime);
  needsOnboardingMock.mockReturnValue(true);
  runOnboardingMock.mockResolvedValue();
  agentCreateForSessionMock.mockResolvedValue({ provider: "openai", modelId: "gpt-test" });

  const { main } = await import("../src/agent/cli.js");
  const { tuiToolRegistry } = await import("../src/agent/tools/tui-tool-registry.js");
  await main();

  expect(initializeRuntimeMock).toHaveBeenCalledTimes(2);
  expect(runOnboardingMock).toHaveBeenCalledWith(firstRuntime);
  expect(launchStartupSandboxMock).toHaveBeenCalledWith(secondRuntime, "agent");
  expect(agentCreateForSessionMock).toHaveBeenCalledWith(secondRuntime, undefined, { toolRegistry: tuiToolRegistry });
  expect(tuiStartMock).toHaveBeenCalledTimes(1);
});
