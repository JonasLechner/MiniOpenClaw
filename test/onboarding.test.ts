import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import type { RuntimePaths } from "../src/core/config.js";
import { needsOnboarding } from "../src/core/onboarding.js";
import { appendContextEntryIfMissing, readOnboardingFile, writeOnboardingFile } from "../src/onboarding/context.js";

let root: string | undefined;

function createRuntimePaths(base: string): RuntimePaths {
  return {
    home: base,
    configFile: join(base, "config.json"),
    authFile: join(base, "auth.json"),
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

test("needsOnboarding returns true when agent provider/model are not configured", () => {
  root = mkdtempSync(join(tmpdir(), "miniopenclaw-onboarding-"));
  const paths = createRuntimePaths(root);
  writeFileSync(paths.configFile, JSON.stringify({ agent: {} }), "utf8");

  assert.equal(needsOnboarding(paths), true);
});

test("needsOnboarding returns false when agent provider/model are configured", () => {
  root = mkdtempSync(join(tmpdir(), "miniopenclaw-onboarding-complete-"));
  const paths = createRuntimePaths(root);
  writeFileSync(paths.configFile, JSON.stringify({ agent: { provider: "openai", modelId: "gpt-test" } }), "utf8");

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

test("writeOnboardingFile overwrites file content and readOnboardingFile returns it", async () => {
  root = mkdtempSync(join(tmpdir(), "miniopenclaw-onboarding-managed-section-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  const userPath = join(workspace, "user.md");
  writeFileSync(userPath, "Existing notes\n", "utf8");

  await writeOnboardingFile(workspace, "user.md", "# User\n- updated");

  assert.equal(readFileSync(userPath, "utf8"), "# User\n- updated\n");
  assert.equal(await readOnboardingFile(workspace, "user.md"), "# User\n- updated\n");
});
