import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { bashTool } from "../src/agent/tools/tool-registry.js";
import { createHostWorkspace } from "../src/core/host-workspace.js";
import type { ContainerEngine, ContainerExecOptions, ContainerInspectResult, ContainerRunOptions } from "../src/sandbox/container-engine.js";
import { ContainerSandbox } from "../src/sandbox/container-sandbox.js";
import { HostSandbox } from "../src/sandbox/host-sandbox.js";
import type { Sandbox, SandboxConfig } from "../src/sandbox/sandbox.js";

const sandboxConfig: SandboxConfig = {
  enabled: true,
  engine: "docker",
  image: "miniopenclaw-sandbox:test",
  network: "none",
};

class MockContainerEngine implements ContainerEngine {
  #workspacePath: string | undefined;
  #running = false;

  async runContainer(options: ContainerRunOptions): Promise<void> {
    this.#workspacePath = options.workspacePath;
    this.#running = true;
  }

  async startContainer(): Promise<void> {
    this.#running = true;
  }

  async execContainer(containerName: string, options: ContainerExecOptions): Promise<{ output: string }> {
    void containerName;
    if (!this.#workspacePath) throw new Error("mock container was not started");
    return new HostSandbox(this.#workspacePath).exec(options.command, {
      timeout: options.timeout,
      signal: options.signal,
    });
  }

  async inspectContainer(): Promise<ContainerInspectResult> {
    return { exists: this.#workspacePath !== undefined, running: this.#running };
  }

  async stopContainer(): Promise<void> {
    this.#running = false;
  }

  async removeContainer(): Promise<void> {
    this.#workspacePath = undefined;
    this.#running = false;
  }
}

const sandboxCases: Array<{ name: string; createSandbox: (workspacePath: string) => Sandbox }> = [
  {
    name: "sandbox disabled / host",
    createSandbox: (workspacePath) => new HostSandbox(workspacePath),
  },
  {
    name: "sandbox enabled / container",
    createSandbox: (workspacePath) => new ContainerSandbox(new MockContainerEngine(), "test-session", workspacePath, sandboxConfig),
  },
];

const toolContext = (workspacePath: string, sandbox: Sandbox) => ({ workspace: createHostWorkspace(workspacePath), sandbox });

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-bash-"));

  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

for (const sandboxCase of sandboxCases) {
  test(`bashTool runs commands in the workspace (${sandboxCase.name})`, async () => {
    await withTempDir(async (dir) => {
      const result = await bashTool.run({
        command: "printf workspace > marker.txt",
      }, toolContext(dir, sandboxCase.createSandbox(dir)));

      assert.equal(result.output, "");
      assert.equal(await readFile(join(dir, "marker.txt"), "utf8"), "workspace");
      assert.equal(result.truncated, false);
    });
  });

  test(`bashTool combines stdout and stderr (${sandboxCase.name})`, async () => {
    await withTempDir(async (dir) => {
      const result = await bashTool.run({
        command: "printf 'out\\n'; printf 'err\\n' >&2",
      }, toolContext(dir, sandboxCase.createSandbox(dir)));

      assert.match(result.output, /out/);
      assert.match(result.output, /err/);
    });
  });

  test(`bashTool rejects non-zero exit codes and includes output (${sandboxCase.name})`, async () => {
    await withTempDir(async (dir) => {
      await assert.rejects(
        () => bashTool.run({
          command: "printf before-fail; exit 7",
        }, toolContext(dir, sandboxCase.createSandbox(dir))),
        (error: unknown) => {
          assert.match(String(error), /before-fail/);
          assert.match(String(error), /Command exited with code 7/);
          return true;
        },
      );
    });
  });

  test(`bashTool abort kills commands that ignore SIGTERM (${sandboxCase.name})`, async () => {
    await withTempDir(async (dir) => {
      const controller = new AbortController();
      const running = bashTool.run(
        { command: 'trap "" TERM; sleep 999' },
        { ...toolContext(dir, sandboxCase.createSandbox(dir)), signal: controller.signal },
      );

      setTimeout(() => controller.abort(), 100);

      await assert.rejects(
        () => running,
        /Command aborted/,
      );
    });
  });

  test(`bashTool rejects timed out commands (${sandboxCase.name})`, async () => {
    await withTempDir(async (dir) => {
      await assert.rejects(
        () => bashTool.run({
          command: "sleep 2",
          timeout: 1,
        }, toolContext(dir, sandboxCase.createSandbox(dir))),
        /Command timed out after 1 seconds/,
      );
    });
  });

  test(`bashTool truncates long output and saves full output (${sandboxCase.name})`, async () => {
    await withTempDir(async (dir) => {
      const result = await bashTool.run({
        command: "printf 'start'; printf '%060000d' 1; printf 'end'",
      }, toolContext(dir, sandboxCase.createSandbox(dir)));

      assert.equal(result.truncated, true);
      assert.ok(result.fullOutputPath);
      assert.match(result.output, /end/);
      assert.doesNotMatch(result.output, /start/);

      const fullOutput = await readFile(result.fullOutputPath as string, "utf8");
      assert.match(fullOutput, /start/);
      assert.match(fullOutput, /end/);
    });
  });
}

test("bashTool uses the provided sandbox", async () => {
  const calls: Array<{ command: string; timeout?: number }> = [];
  const sandbox: Sandbox = {
    async ensure() {
      // no-op
    },
    async exec(command, options) {
      calls.push({ command, timeout: options?.timeout });
      return { output: "sandbox-output" };
    },
  };

  const result = await bashTool.run(
    { command: "echo hi", timeout: 3 },
    { workspace: createHostWorkspace(process.cwd()), sandbox },
  );

  assert.equal(result.output, "sandbox-output");
  assert.deepEqual(calls, [{ command: "echo hi", timeout: 3 }]);
});
