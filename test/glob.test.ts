import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { test } from "vitest";
import { globTool } from "../src/agent/tools/index.js";
import { HostSandbox } from "../src/sandbox/host-sandbox.js";
import { createHostWorkspace } from "../src/core/host-workspace.js";

const toolContext = (workspacePath: string) => ({ workspace: createHostWorkspace(workspacePath), sandbox: new HostSandbox(workspacePath) });

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
    }, toolContext(dir));

    assert.deepEqual(result.details, {
      path: dir,
      matches: ["src/a.ts", "src/nested/b.ts"],
      truncation: undefined,
    });
    assert.equal(result.content[0].type, "text");
    assert.equal(result.content[0].text, "src/a.ts\nsrc/nested/b.ts");
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
    }, toolContext(dir));

    assert.deepEqual(result.details?.matches, ["a.ts"]);
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
    }, toolContext(dir));

    assert.deepEqual(result.details?.matches, ["Alpha.TS"]);
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
    }, toolContext(dir));

    assert.deepEqual(result.details?.matches, ["src", "src/nested", "src/nested/file.txt"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

