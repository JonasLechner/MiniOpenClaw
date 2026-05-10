import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import test from "node:test";
import { writeTool } from "../src/tools/index.js";

test("writeTool writes a new file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-write-"));

  try {
    const filePath = join(dir, "sample.txt");
    const result = await writeTool.run({
      path: filePath,
      content: "Hello",
    });

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
    });

    const result = await writeTool.run({
      path: filePath,
      content: "New",
    });

    const content = await readFile(filePath, "utf8");

    assert.equal(content, "New");
    assert.equal(result.path, filePath);
    assert.equal(result.bytesWritten, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
