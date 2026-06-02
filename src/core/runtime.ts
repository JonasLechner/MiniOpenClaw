import { join } from "node:path";
import { ensureDir, ensureJsonFile, loadRuntimeConfig, type RuntimeConfig, type RuntimePaths } from "./config.js";
import { configureLogging } from "./log.js";

export type RuntimeState = RuntimeConfig;

const memoryCategories = ["projects", "decisions", "preferences", "session-summaries"] as const;
const defaultMemoryIndex = {
  version: 1,
  strategy: {
    rebuild: "lazy",
    ranking: "keyword-first",
  },
  generatedAt: new Date(0).toISOString(),
  entries: [],
};

export function ensureRuntimeFiles(paths: RuntimePaths): void {
  ensureDir(paths.home);
  ensureDir(paths.sessions);
  ensureDir(paths.workspace);
  ensureDir(paths.memory);

  for (const category of memoryCategories) {
    ensureDir(join(paths.memory, category));
  }

  ensureJsonFile(join(paths.memory, "index.json"), defaultMemoryIndex);
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
