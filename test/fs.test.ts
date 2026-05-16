import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, win32 } from "node:path";
import { test } from "vitest";
import { editTool, globTool, grepTool, readTool, writeTool } from "../src/agent/tools/index.js";
import { isWithinWorkspacePath } from "../src/agent/tools/fs.js";

const toolContext = (workspacePath: string) => ({ workspacePath });

interface SandboxFixture {
  root: string;
  workspace: string;
  outside: string;
}

async function createSandboxFixture(): Promise<SandboxFixture> {
  const root = await mkdtemp(join(tmpdir(), "miniopenclaw-fs-"));
  const workspace = join(root, "workspace");
  const outside = join(root, "outside");

  await mkdir(workspace, { recursive: true });
  await mkdir(outside, { recursive: true });

  return { root, workspace, outside };
}

async function withSandboxFixture(run: (fixture: SandboxFixture) => Promise<void>): Promise<void> {
  const fixture = await createSandboxFixture();

  try {
    await run(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function createEscapeLink(linkPath: string, targetPath: string): Promise<void> {
  await mkdir(dirname(linkPath), { recursive: true });
  await symlink(targetPath, linkPath, process.platform === "win32" ? "junction" : "dir");
}

test("isWithinWorkspacePath handles Windows-style paths", () => {
  assert.equal(isWithinWorkspacePath("C:\\workspace", "C:\\workspace\\file.txt", win32), true);
  assert.equal(isWithinWorkspacePath("C:\\workspace", "C:\\workspace\\nested\\file.txt", win32), true);
  assert.equal(isWithinWorkspacePath("C:\\workspace", "C:\\other\\file.txt", win32), false);
  assert.equal(isWithinWorkspacePath("C:\\workspace", "D:\\workspace\\file.txt", win32), false);
});

test("readTool rejects symlink escapes", async () => {
  await withSandboxFixture(async ({ workspace, outside }) => {
    await writeFile(join(outside, "secret.txt"), "secret", "utf8");
    await createEscapeLink(join(workspace, "escape"), outside);

    await assert.rejects(() => readTool.run({ path: join(workspace, "escape", "secret.txt") }, toolContext(workspace)));
  });
});

test("writeTool rejects symlink escapes", async () => {
  await withSandboxFixture(async ({ workspace, outside }) => {
    const outsideFile = join(outside, "written.txt");

    await createEscapeLink(join(workspace, "escape"), outside);

    await assert.rejects(() => writeTool.run({ path: join(workspace, "escape", "written.txt"), content: "nope" }, toolContext(workspace)));
    await assert.rejects(() => readFile(outsideFile, "utf8"));
  });
});

test("editTool rejects symlink escapes", async () => {
  await withSandboxFixture(async ({ workspace, outside }) => {
    const outsideFile = join(outside, "sample.txt");

    await writeFile(outsideFile, "a\nb\n", "utf8");
    await createEscapeLink(join(workspace, "escape"), outside);

    await assert.rejects(() => editTool.run({
      path: join(workspace, "escape", "sample.txt"),
      startLine: 1,
      endLine: 1,
      newText: "x",
    }, toolContext(workspace)));

    assert.equal(await readFile(outsideFile, "utf8"), "a\nb\n");
  });
});

test("grepTool rejects symlink escapes", async () => {
  await withSandboxFixture(async ({ workspace, outside }) => {
    await writeFile(join(outside, "sample.txt"), "secret\n", "utf8");
    await createEscapeLink(join(workspace, "escape"), outside);

    await assert.rejects(() => grepTool.run({ path: join(workspace, "escape", "sample.txt"), pattern: "secret" }, toolContext(workspace)));
  });
});

test("globTool rejects symlink escape roots", async () => {
  await withSandboxFixture(async ({ workspace, outside }) => {
    await writeFile(join(outside, "sample.txt"), "secret\n", "utf8");
    await createEscapeLink(join(workspace, "escape"), outside);

    await assert.rejects(() => globTool.run({ path: join(workspace, "escape"), pattern: "**/*" }, toolContext(workspace)));
  });
});
