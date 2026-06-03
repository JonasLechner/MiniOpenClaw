import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, ensureJsonFile, loadRuntimeConfig, type RuntimeConfig, type RuntimePaths } from "./config.js";
import { configureLogging } from "./log.js";

export type RuntimeState = RuntimeConfig;

function ensureTextFile(path: string, content: string): void {
  if (existsSync(path)) return;
  writeFileSync(path, content, "utf8");
}

export function ensureRuntimeFiles(paths: RuntimePaths): void {
  ensureDir(paths.home);
  ensureDir(paths.sessions);
  ensureDir(paths.workspace);
  ensureDir(join(paths.workspace, "memory"));
  ensureDir(join(paths.workspace, "project"));

  ensureTextFile(join(paths.workspace, "context.md"), "");
  ensureJsonFile(paths.authFile, {});
  ensureJsonFile(paths.conversationBindings, []);
  ensureJsonFile(paths.scheduledTasks, []);
}

export function initializeRuntime(): RuntimeState {
  const runtime = loadRuntimeConfig();
  configureLogging(runtime.config.logging.level);
  ensureRuntimeFiles(runtime.paths);
  return runtime;
}
