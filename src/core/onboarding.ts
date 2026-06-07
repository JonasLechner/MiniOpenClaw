import { existsSync, readFileSync } from "node:fs";
import type { UserConfig, RuntimePaths } from "./config.js";

export function needsOnboarding(paths: RuntimePaths): boolean {
  if (!existsSync(paths.configFile)) {
    return true;
  }

  const parsed = JSON.parse(readFileSync(paths.configFile, "utf8")) as UserConfig;
  return !(parsed.agent?.provider && parsed.agent?.modelId);
}
