import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { ensureDir, type RuntimePaths } from "./config.js";

export type OnboardingStep =
  | "welcome"
  | "name"
  | "sandbox_enabled"
  | "provider"
  | "model"
  | "auth"
  | "telegram_enabled"
  | "telegram_token"
  | "telegram_allowed_users"
  | "review"
  | "done";

export type OnboardingState = {
  completed: boolean;
  step: OnboardingStep;
  data: {
    name?: string;
    sandboxEnabled?: boolean;
    provider?: string;
    modelId?: string;
    telegramEnabled?: boolean;
    telegramToken?: string;
    telegramAllowedUserIds?: string[];
  };
};

export function createDefaultOnboardingState(): OnboardingState {
  return {
    completed: false,
    step: "welcome",
    data: {},
  };
}

export function loadOnboardingState(paths: RuntimePaths): OnboardingState | undefined {
  if (!existsSync(paths.onboardingState)) return undefined;
  return JSON.parse(readFileSync(paths.onboardingState, "utf8")) as OnboardingState;
}

export function saveOnboardingState(paths: RuntimePaths, state: OnboardingState): void {
  ensureDir(paths.home);
  writeFileSync(paths.onboardingState, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function clearOnboardingState(paths: RuntimePaths): void {
  rmSync(paths.onboardingState, { force: true });
}

export function needsOnboarding(paths: RuntimePaths): boolean {
  const state = loadOnboardingState(paths);
  return !state || !state.completed;
}
