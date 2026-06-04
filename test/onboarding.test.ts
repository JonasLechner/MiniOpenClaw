import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import type { RuntimePaths } from "../src/core/config.js";
import {
  clearOnboardingState,
  createDefaultOnboardingState,
  loadOnboardingState,
  needsOnboarding,
  saveOnboardingState,
} from "../src/core/onboarding.js";
import { appendContextEntryIfMissing } from "../src/onboarding/context.js";

let root: string | undefined;

function createRuntimePaths(base: string): RuntimePaths {
  return {
    home: base,
    configFile: join(base, "config.json"),
    authFile: join(base, "auth.json"),
    onboardingState: join(base, "onboarding.json"),
    sessions: join(base, "sessions"),
    workspace: join(base, "workspace"),
    memory: join(base, "workspace", "memory"),
    conversationBindings: join(base, "conversation-bindings.json"),
    scheduledTasks: join(base, "scheduled-tasks.json"),
  };
}

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true });
    root = undefined;
  }
});

test("onboarding state can be saved, loaded, and cleared", () => {
  root = mkdtempSync(join(tmpdir(), "miniopenclaw-onboarding-"));
  const paths = createRuntimePaths(root);
  const state = createDefaultOnboardingState();
  state.step = "provider";
  state.data.name = "Sepp";

  saveOnboardingState(paths, state);
  assert.deepEqual(loadOnboardingState(paths), state);
  assert.equal(needsOnboarding(paths), true);

  clearOnboardingState(paths);
  assert.equal(loadOnboardingState(paths), undefined);
});

test("needsOnboarding returns false for completed state", () => {
  root = mkdtempSync(join(tmpdir(), "miniopenclaw-onboarding-complete-"));
  const paths = createRuntimePaths(root);
  const state = createDefaultOnboardingState();
  state.completed = true;
  state.step = "done";

  saveOnboardingState(paths, state);
  assert.equal(needsOnboarding(paths), false);
});

test("appendContextEntryIfMissing rethrows non-ENOENT read errors", async () => {
  root = mkdtempSync(join(tmpdir(), "miniopenclaw-onboarding-context-error-"));
  const workspace = join(root, "workspace");
  mkdirSync(join(workspace, "context.md"), { recursive: true });

  await assert.rejects(() => appendContextEntryIfMissing(workspace, "My name is Sepp"));
});

test("appendContextEntryIfMissing appends once and dedupes", async () => {
  root = mkdtempSync(join(tmpdir(), "miniopenclaw-onboarding-context-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(root, "workspace", "context.md"), "", { encoding: "utf8", flag: "w" });

  await appendContextEntryIfMissing(workspace, "My name is Sepp");
  await appendContextEntryIfMissing(workspace, "My name is Sepp");

  assert.equal(readFileSync(join(workspace, "context.md"), "utf8"), "My name is Sepp\n");
});
