import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { test } from "vitest";
import type { Sandbox } from "../src/sandbox/sandbox.js";
import { HostSandbox } from "../src/sandbox/host-sandbox.js";
import { createHostWorkspace } from "../src/core/host-workspace.js";
import { bashTool } from "../src/agent/tools/tool-registry.js";

const toolContext = (workspacePath: string) => ({ workspace: createHostWorkspace(workspacePath), sandbox: new HostSandbox(workspacePath) });

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-bash-"));

  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("bashTool runs commands in the workspace", async () => {
  await withTempDir(async (dir) => {
    const node = JSON.stringify(process.execPath);
    const result = await bashTool.run({
      command: `${node} -e "process.stdout.write(process.cwd())"`,
    }, toolContext(dir));

    assert.equal(result.output, dir);
    assert.equal(result.truncated, false);
  });
});

test("bashTool combines stdout and stderr", async () => {
  await withTempDir(async (dir) => {
    const node = JSON.stringify(process.execPath);
    const result = await bashTool.run({
      command: `${node} -e "process.stdout.write('out\\n'); process.stderr.write('err\\n')"`,
    }, toolContext(dir));

    assert.match(result.output, /out/);
    assert.match(result.output, /err/);
  });
});

test("bashTool rejects non-zero exit codes and includes output", async () => {
  await withTempDir(async (dir) => {
    const node = JSON.stringify(process.execPath);

    await assert.rejects(
      () => bashTool.run({
        command: `${node} -e "process.stdout.write('before-fail'); process.exit(7)"`,
      }, toolContext(dir)),
      (error: unknown) => {
        assert.match(String(error), /before-fail/);
        assert.match(String(error), /Command exited with code 7/);
        return true;
      },
    );
  });
});

test("bashTool abort kills host commands that ignore SIGTERM", async () => {
  await withTempDir(async (dir) => {
    const controller = new AbortController();
    const running = bashTool.run(
      { command: 'trap "" TERM; sleep 999' },
      { ...toolContext(dir), signal: controller.signal },
    );

    setTimeout(() => controller.abort(), 100);

    await assert.rejects(
      () => running,
      /Command aborted/,
    );
  });
});

test("bashTool rejects timed out commands", async () => {
  await withTempDir(async (dir) => {
    const node = JSON.stringify(process.execPath);

    await assert.rejects(
      () => bashTool.run({
        command: `${node} -e "setTimeout(() => {}, 2000)"`,
        timeout: 1,
      }, toolContext(dir)),
      /Command timed out after 1 seconds/,
    );
  });
});

test("bashTool allows host execution when given host sandbox", async () => {
  await withTempDir(async (dir) => {
    const node = JSON.stringify(process.execPath);
    const result = await bashTool.run(
      { command: `${node} -e "process.stdout.write(process.cwd())"` },
      { workspace: createHostWorkspace(dir), sandbox: new HostSandbox(dir) },
    );

    assert.equal(result.output, dir);
  });
});

test("bashTool uses host execution when given host sandbox", async () => {
  const workspacePath = process.cwd();
  const result = await bashTool.run(
    { command: "echo hi" },
    { workspace: createHostWorkspace(workspacePath), sandbox: new HostSandbox(workspacePath) },
  );

  assert.equal(result.output, "hi\n");
});

test("bashTool uses the provided sandbox when available", async () => {
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

test("bashTool truncates long output and saves full output", async () => {
  await withTempDir(async (dir) => {
    const node = JSON.stringify(process.execPath);
    const result = await bashTool.run({
      command: `${node} -e "for (let i = 0; i < 2505; i += 1) console.log('line-' + i)"`,
    }, toolContext(dir));

    assert.equal(result.truncated, true);
    assert.ok(result.fullOutputPath);
    assert.match(result.output, /line-2504/);
    assert.doesNotMatch(result.output, /line-0/);

    const fullOutput = await readFile(result.fullOutputPath as string, "utf8");
    assert.match(fullOutput, /line-0/);
    assert.match(fullOutput, /line-2504/);
  });
});
