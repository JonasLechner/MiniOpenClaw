import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import test from "node:test";
import { globTool } from "../src/tools/index.js";

test("globTool finds files with recursive glob", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-glob-"));

  try {
    await mkdir(join(dir, "src", "nested"), { recursive: true });
    await writeFile(join(dir, "src", "a.ts"), "", "utf8");
    await writeFile(join(dir, "src", "nested", "b.ts"), "", "utf8");
    await writeFile(join(dir, "src", "nested", "c.js"), "", "utf8");

    const result = await globTool.run({
      path: dir,
      pattern: "src/**/*.ts",
    });

    assert.deepEqual(result, {
      path: dir,
      matches: ["src/a.ts", "src/nested/b.ts"],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("globTool supports non-recursive glob", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-glob-"));

  try {
    await mkdir(join(dir, "src", "nested"), { recursive: true });
    await writeFile(join(dir, "src", "a.ts"), "", "utf8");
    await writeFile(join(dir, "src", "nested", "b.ts"), "", "utf8");

    const result = await globTool.run({
      path: join(dir, "src"),
      pattern: "*.ts",
    });

    assert.deepEqual(result.matches, ["a.ts"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("globTool supports case-insensitive matching", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-glob-"));

  try {
    await writeFile(join(dir, "Alpha.TS"), "", "utf8");

    const result = await globTool.run({
      path: dir,
      pattern: "*.ts",
      caseSensitive: false,
    });

    assert.deepEqual(result.matches, ["Alpha.TS"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("globTool can include directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miniopenclaw-glob-"));

  try {
    await mkdir(join(dir, "src", "nested"), { recursive: true });
    await writeFile(join(dir, "src", "nested", "file.txt"), "", "utf8");

    const result = await globTool.run({
      path: dir,
      pattern: "src/**",
      includeDirectories: true,
    });

    assert.deepEqual(result.matches, ["src", "src/nested", "src/nested/file.txt"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

