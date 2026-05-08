import { ensureRuntimeFiles, loadRuntimeConfig, type RuntimeConfig } from "./config.js";

export type RuntimeState = RuntimeConfig;

export function initializeRuntime(): RuntimeState {
  const runtime = loadRuntimeConfig();
  ensureRuntimeFiles(runtime.paths);
  return runtime;
}
