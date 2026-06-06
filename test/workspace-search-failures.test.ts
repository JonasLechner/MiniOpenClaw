import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";

const blockedRealpaths = new Set<string>();

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

  return {
    ...actual,
    realpath: async (path: Parameters<typeof actual.realpath>[0], options?: Parameters<typeof actual.realpath>[1]) => {
      const resolved = typeof path === "string" ? path : String(path);
      if (blockedRealpaths.has(resolved)) {
        const error = new Error(`blocked realpath: ${resolved}`) as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
        return actual.realpath(path, options as never);
    },
  };
});

afterEach(() => {
  blockedRealpaths.clear();
  vi.resetModules();
});

test("workspace search refresh surfaces non-ENOENT realpath failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "miniopenclaw-workspace-search-realpath-"));

  try {
    await mkdir(join(root, "notes"), { recursive: true });
    const filePath = join(root, "notes", "a.md");
    await writeFile(filePath, "sqlite note\n", "utf8");
    blockedRealpaths.add(filePath);

    const { refreshWorkspaceSearchIndexForWorkspace } = await import("../src/core/workspace-search-index.js");

    await assert.rejects(
      () => refreshWorkspaceSearchIndexForWorkspace(root),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "EACCES",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace search watcher surfaces update failures instead of swallowing them", async () => {
  const root = await mkdtemp(join(tmpdir(), "miniopenclaw-workspace-search-watcher-failure-"));
  let indexer: { start(): Promise<void>; stop(): Promise<void> } | undefined;
  let uncaughtListener: ((error: Error) => void) | undefined;

  try {
    await mkdir(join(root, "notes"), { recursive: true });
    const filePath = join(root, "notes", "a.md");
    await writeFile(filePath, "sqlite note\n", "utf8");

    const { createWorkspaceSearchIndexerForWorkspace } = await import("../src/core/workspace-search-index.js");
    indexer = createWorkspaceSearchIndexerForWorkspace(root);
    await indexer.start();

    const uncaughtError = new Promise<Error>((resolve) => {
      uncaughtListener = (error) => resolve(error);
      process.once("uncaughtException", uncaughtListener);
    });

    blockedRealpaths.add(filePath);
    await writeFile(filePath, "sqlite note updated\n", "utf8");

    const error = await uncaughtError;
    assert.equal(error.message, `blocked realpath: ${filePath}`);
    assert.equal((error as NodeJS.ErrnoException).code, "EACCES");
  } finally {
    if (uncaughtListener) {
      process.removeListener("uncaughtException", uncaughtListener);
    }
    blockedRealpaths.clear();
    await indexer?.stop().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
