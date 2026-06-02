import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { test } from "vitest";
import { writeTool } from "../src/agent/tools/index.js";
import { HostSandbox } from "../src/lib/sandbox/host-sandbox.js";
import { createHostWorkspace } from "../src/lib/workspace/host-workspace.js";

const toolContext = (workspacePath: string) => ({ workspace: createHostWorkspace(workspacePath), sandbox: new HostSandbox(workspacePath) });

test("writeTool writes a new file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-write-"));

  try {
    const filePath = join(dir, "sample.txt");
    const result = await writeTool.run({
      path: filePath,
      content: "Hello",
    }, toolContext(dir));

    const content = await readFile(filePath, "utf8");

    assert.equal(content, "Hello");
    assert.equal(result.path, filePath);
    assert.equal(result.bytesWritten, 5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeTool overwrites an existing file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-write-"));

  try {
    const filePath = join(dir, "sample.txt");

    await writeTool.run({
      path: filePath,
      content: "Old content",
    }, toolContext(dir));

    const result = await writeTool.run({
      path: filePath,
      content: "New",
    }, toolContext(dir));

    const content = await readFile(filePath, "utf8");

    assert.equal(content, "New");
    assert.equal(result.path, filePath);
    assert.equal(result.bytesWritten, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
