import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import test from "node:test";
import { editTool } from "../src/tools";

test("editTool replaces a single line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-edit-"));

  try {
    const filePath = join(dir, "sample.txt");
    await writeFile(filePath, "line 1\nline 2\nline 3\n", "utf8");

    const result = await editTool.run({
      path: filePath,
      startLine: 2,
      endLine: 2,
      newText: "updated line 2",
    });

    const content = await readFile(filePath, "utf8");

    assert.equal(content, "line 1\nupdated line 2\nline 3\n");
    assert.equal(result.path, filePath);
    assert.equal(result.replacements, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("editTool replaces multiple lines", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-edit-"));

  try {
    const filePath = join(dir, "sample.txt");
    await writeFile(filePath, "a\nb\nc\nd\n", "utf8");

    await editTool.run({
      path: filePath,
      startLine: 2,
      endLine: 3,
      newText: "x\ny",
    });

    const content = await readFile(filePath, "utf8");

    assert.equal(content, "a\nx\ny\nd\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("editTool can remove lines", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-edit-"));

  try {
    const filePath = join(dir, "sample.txt");
    await writeFile(filePath, "a\nb\nc\n", "utf8");

    await editTool.run({
      path: filePath,
      startLine: 2,
      endLine: 2,
      newText: "",
    });

    const content = await readFile(filePath, "utf8");

    assert.equal(content, "a\nc\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("editTool rejects invalid line order", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-edit-"));

  try {
    const filePath = join(dir, "sample.txt");
    await writeFile(filePath, "a\nb\n", "utf8");

    await assert.rejects(() =>
      editTool.run({
        path: filePath,
        startLine: 3,
        endLine: 2,
        newText: "x",
      }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("editTool rejects out of bounds line ranges", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-edit-"));

  try {
    const filePath = join(dir, "sample.txt");
    await writeFile(filePath, "a\nb\n", "utf8");

    await assert.rejects(() =>
      editTool.run({
        path: filePath,
        startLine: 2,
        endLine: 3,
        newText: "x",
      }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("editTool rejects line numbers below 1", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-edit-"));

  try {
    const filePath = join(dir, "sample.txt");
    await writeFile(filePath, "a\nb\n", "utf8");

    await assert.rejects(() =>
      editTool.run({
        path: filePath,
        startLine: 0,
        endLine: 1,
        newText: "x",
      }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
