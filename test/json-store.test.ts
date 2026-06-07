import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import { readJsonFile, updateJsonFile } from "../src/core/json-store.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

test("updateJsonFile merges concurrent read-modify-write updates without losing data", async () => {
  const root = mkdtempSync(join(tmpdir(), "miniopenclaw-json-store-"));
  tempRoots.push(root);
  const path = join(root, "current-sessions.json");

  await Promise.all([
    updateJsonFile(path, {} as Record<string, string>, async (current) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { ...current, tui: "session-tui" };
    }),
    updateJsonFile(path, {} as Record<string, string>, async (current) => ({
      ...current,
      gateway: "session-gateway",
    })),
  ]);

  const persisted = await readJsonFile(path, {} as Record<string, string>);
  assert.deepEqual(persisted, {
    tui: "session-tui",
    gateway: "session-gateway",
  });
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")) as Record<string, string>, persisted);
});
