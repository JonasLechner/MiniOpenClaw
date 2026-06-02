import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SpawnResult = {
  stdout?: string;
  stderr?: string;
  code?: number | null;
  error?: Error;
};

const spawnQueue: SpawnResult[] = [];
const spawnCalls: Array<{ command: string; args: string[] }> = [];

vi.mock("node:child_process", () => ({
  spawn: vi.fn((command: string, args: string[]) => {
    const result = spawnQueue.shift();
    if (!result) {
      throw new Error(`No mocked spawn result for ${command} ${args.join(" ")}`);
    }

    spawnCalls.push({ command, args });

    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};

    queueMicrotask(() => {
      if (result.error) {
        child.emit("error", result.error);
        return;
      }
      if (result.stdout) {
        child.stdout.emit("data", Buffer.from(result.stdout));
      }
      if (result.stderr) {
        child.stderr.emit("data", Buffer.from(result.stderr));
      }
      child.emit("close", result.code ?? 0);
    });

    return child;
  }),
}));

describe("CliContainerEngine cleanup", () => {
  beforeEach(() => {
    spawnQueue.length = 0;
    spawnCalls.length = 0;
    vi.resetModules();
  });

  afterEach(() => {
    spawnQueue.length = 0;
    spawnCalls.length = 0;
  });

  it("treats a missing container as already stopped without parsing stderr text", async () => {
    const { CliContainerEngine } = await import("../src/lib/container-engine/docker.js");
    const engine = new CliContainerEngine("docker");

    spawnQueue.push({ code: 1, stderr: "different localized message" });

    await engine.stopContainer("miniopenclaw-test");

    expect(spawnCalls.map((call) => call.args)).toEqual([
      ["inspect", "-f", "{{.State.Running}}", "miniopenclaw-test"],
    ]);
  });

  it("treats a container that disappears during rm as already removed", async () => {
    const { CliContainerEngine } = await import("../src/lib/container-engine/docker.js");
    const engine = new CliContainerEngine("docker");

    spawnQueue.push(
      { code: 0, stdout: "true\n" },
      { code: 1, stderr: "unexpected rm failure text" },
      { code: 1, stderr: "different inspect missing text" },
    );

    await engine.removeContainer("miniopenclaw-test");

    expect(spawnCalls.map((call) => call.args)).toEqual([
      ["inspect", "-f", "{{.State.Running}}", "miniopenclaw-test"],
      ["rm", "-f", "miniopenclaw-test"],
      ["inspect", "-f", "{{.State.Running}}", "miniopenclaw-test"],
    ]);
  });

  it("fails fast when rm fails and the container still exists", async () => {
    const { CliContainerEngine } = await import("../src/lib/container-engine/docker.js");
    const engine = new CliContainerEngine("docker");

    spawnQueue.push(
      { code: 0, stdout: "true\n" },
      { code: 125, stderr: "rm failed" },
      { code: 0, stdout: "false\n" },
    );

    await expect(engine.removeContainer("miniopenclaw-test")).rejects.toThrow("rm failed");
  });
});
