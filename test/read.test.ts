import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { test } from "vitest";
import { readTool } from "../src/agent/tools/index.js";
import { HostSandbox } from "../src/lib/sandbox/host-sandbox.js";

const toolContext = (workspacePath: string) => ({ workspacePath, sandbox: new HostSandbox(workspacePath) });

test("readTool reads full file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-read-"));

  try {
    const filePath = join(dir, "sample.txt");
    await writeFile(filePath, "A\nB\nC\n", "utf8");

    const content = await readTool.run({ path: filePath }, toolContext(dir));

    assert.equal(content, "A\nB\nC\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readTool reads a line range", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-read-"));

  try {
    const filePath = join(dir, "sample.txt");
    await writeFile(filePath, "A\nB\nC\nD\n", "utf8");

    const content = await readTool.run({
      path: filePath,
      startLine: 2,
      endLine: 3,
    }, toolContext(dir));

    assert.equal(content, "B\nC");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readTool reads a single line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-read-"));

  try {
    const filePath = join(dir, "sample.txt");
    await writeFile(filePath, "A\nB\nC\n", "utf8");

    const content = await readTool.run({
      path: filePath,
      startLine: 2,
      endLine: 2,
    }, toolContext(dir));

    assert.equal(content, "B");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readTool rejects for missing files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-read-"));

  try {
    const filePath = join(dir, "missing.txt");

    await assert.rejects(() => readTool.run({ path: filePath }, toolContext(dir)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readTool rejects paths outside the workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "miniopenclaw-read-"));
  const workspace = join(root, "workspace");
  const outsideFilePath = join(root, "outside.txt");

  try {
    await writeFile(outsideFilePath, "secret", "utf8");

    await assert.rejects(() => readTool.run({ path: outsideFilePath }, toolContext(workspace)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
