import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { test } from "vitest";
import { bashTool } from "../src/agent/tools/index.js";

const toolContext = (workspacePath: string) => ({ workspacePath });

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

test("bashTool truncates long output and saves full output", async () => {
  await withTempDir(async (dir) => {
    const node = JSON.stringify(process.execPath);
    const result = await bashTool.run({
      command: `${node} -e "for (let i = 0; i < 2505; i += 1) console.log('line-' + i)"`,
    }, toolContext(dir));

    assert.equal(result.truncated, true);
    assert.ok(result.fullOutputPath);
    assert.equal(result.truncatedBy, "lines");
    assert.match(result.output, /line-2504/);
    assert.doesNotMatch(result.output, /line-0/);

    const fullOutput = await readFile(result.fullOutputPath as string, "utf8");
    assert.match(fullOutput, /line-0/);
    assert.match(fullOutput, /line-2504/);
  });
});
