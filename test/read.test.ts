import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { test } from "vitest";
import { readTool } from "../src/agent/tools/index.js";
import { DEFAULT_MAX_OUTPUT_BYTES } from "../src/agent/tools/truncate.js";
import { HostSandbox } from "../src/sandbox/host-sandbox.js";
import { createHostWorkspace } from "../src/core/host-workspace.js";

const toolContext = (workspacePath: string) => ({ workspace: createHostWorkspace(workspacePath), sandbox: new HostSandbox(workspacePath) });

test("readTool reads full file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-read-"));

  try {
    const filePath = join(dir, "sample.txt");
    await writeFile(filePath, "A\nB\nC\n", "utf8");

    const content = await readTool.run({ path: filePath }, toolContext(dir));

    assert.equal(content.content[0].type, "text");
    assert.equal(content.content[0].text, "A\nB\nC\n");
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

    assert.equal(content.content[0].type, "text");
    assert.equal(content.content[0].text, "B\nC\n\n[1 more lines in file. Use startLine=4 to continue.]");
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

    assert.equal(content.content[0].type, "text");
    assert.equal(content.content[0].text, "B\n\n[1 more lines in file. Use startLine=3 to continue.]");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readTool gives a bash fallback for a single oversized line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-read-"));

  try {
    const filePath = join(dir, "single-line with 'quotes' and $(shell).txt");
    const longLine = "x".repeat(DEFAULT_MAX_OUTPUT_BYTES + 100);
    await writeFile(filePath, longLine, "utf8");

    const content = await readTool.run({ path: filePath }, toolContext(dir));

    assert.equal(content.content[0].type, "text");
    assert.match(content.content[0].text, /Line 1 is \d+KB, exceeds 50KB limit/);
    assert.match(content.content[0].text, /sed -n '1p'/);
    assert.match(content.content[0].text, /'[^']*single-line with '\\''quotes'\\'' and \$\(shell\)\.txt'/);
    assert.equal(content.details?.truncation, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readTool rejects startLine beyond end of file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-read-"));

  try {
    const filePath = join(dir, "sample.txt");
    await writeFile(filePath, "A\nB\n", "utf8");

    await assert.rejects(
      () => readTool.run({ path: filePath, startLine: 99 }, toolContext(dir)),
      /beyond end of file/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readTool returns supported images as image content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-read-"));

  try {
    const filePath = join(dir, "sample.png");
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    await writeFile(filePath, png);

    const content = await readTool.run({ path: filePath }, toolContext(dir));

    assert.equal(content.content[0].type, "text");
    assert.equal(content.content[0].text, "Read image file [image/png]");
    assert.equal(content.content[1].type, "image");
    assert.equal(content.content[1].mimeType, "image/png");
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
