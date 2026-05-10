import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import test from "node:test";
import { grepTool } from "../src/tools/index.js";

test("grepTool finds plain text matches", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-grep-"));

  try {
    const filePath = join(dir, "sample.txt");
    await writeFile(filePath, "alpha\nbeta\nalphabet\n", "utf8");

    const result = await grepTool.run({
      path: filePath,
      pattern: "alpha",
    });

    assert.deepEqual(result, {
      path: filePath,
      matches: [
        { lineNumber: 1, line: "alpha" },
        { lineNumber: 3, line: "alphabet" },
      ],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("grepTool supports case-insensitive search", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-grep-"));

  try {
    const filePath = join(dir, "sample.txt");
    await writeFile(filePath, "Alpha\nbeta\nALPHA\n", "utf8");

    const result = await grepTool.run({
      path: filePath,
      pattern: "alpha",
      caseSensitive: false,
    });

    assert.deepEqual(result.matches, [
      { lineNumber: 1, line: "Alpha" },
      { lineNumber: 3, line: "ALPHA" },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("grepTool supports regex search", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-grep-"));

  try {
    const filePath = join(dir, "sample.txt");
    await writeFile(filePath, "abc123\nabc\nxyz789\n", "utf8");

    const result = await grepTool.run({
      path: filePath,
      pattern: "^[a-z]+\\d+$",
      useRegex: true,
    });

    assert.deepEqual(result.matches, [
      { lineNumber: 1, line: "abc123" },
      { lineNumber: 3, line: "xyz789" },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("grepTool limits search to a line range", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-grep-"));

  try {
    const filePath = join(dir, "sample.txt");
    await writeFile(filePath, "match\nskip\nmatch\nmatch\n", "utf8");

    const result = await grepTool.run({
      path: filePath,
      pattern: "match",
      startLine: 2,
      endLine: 3,
    });

    assert.deepEqual(result.matches, [
      { lineNumber: 3, line: "match" },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("grepTool rejects invalid line order", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-grep-"));

  try {
    const filePath = join(dir, "sample.txt");
    await writeFile(filePath, "a\nb\n", "utf8");

    await assert.rejects(() =>
      grepTool.run({
        path: filePath,
        pattern: "a",
        startLine: 3,
        endLine: 2,
      }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("grepTool rejects invalid regex patterns", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-grep-"));

  try {
    const filePath = join(dir, "sample.txt");
    await writeFile(filePath, "a\nb\n", "utf8");

    await assert.rejects(() =>
      grepTool.run({
        path: filePath,
        pattern: "[",
        useRegex: true,
      }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
