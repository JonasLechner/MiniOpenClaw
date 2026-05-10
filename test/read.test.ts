import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import test from "node:test";
import { readTool } from "../src/tools/index.js";

test("readTool reads full file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-read-"));

  try {
    const filePath = join(dir, "sample.txt");
    await writeFile(filePath, "A\nB\nC\n", "utf8");

    const content = await readTool.run({ path: filePath });

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
    });

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
    });

    assert.equal(content, "B");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readTool rejects for missing files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-read-"));

  try {
    const filePath = join(dir, "missing.txt");

    await assert.rejects(() => readTool.run({ path: filePath }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
