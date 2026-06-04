import { existsSync, readFileSync } from "node:fs";
import { getModels, type KnownProvider } from "@earendil-works/pi-ai";
import { getOAuthProviders } from "@earendil-works/pi-ai/oauth";
import { runOAuthLogin } from "../agent/auth.js";
import { updateUserConfig } from "../core/config.js";
import type { RuntimeState } from "../core/runtime.js";
import {
  createDefaultOnboardingState,
  loadOnboardingState,
  saveOnboardingState,
  type OnboardingState,
} from "../core/onboarding.js";
import { appendContextEntryIfMissing } from "./context.js";
import { promptSelect, promptText, promptYesNo } from "./cli.js";

function getProviderOptions(): Array<{ id: string; name: string }> {
  const allowedProviderIds = ["openai-codex", "github-copilot"];
  return allowedProviderIds.flatMap((providerId) => {
    const provider = getOAuthProviders().find((candidate) => candidate.id === providerId);
    return provider ? [{ id: provider.id, name: provider.name }] : [];
  });
}

function getModelIds(runtime: RuntimeState, providerId: string): string[] {
  const configured = runtime.config.agent.availableModels?.[providerId];
  if (configured && configured.length > 0) {
    return configured;
  }

  const models = getModels(providerId as KnownProvider).map((model) => model.id).sort();
  return [...new Set(models)];
}

function hasOAuthAuthForProvider(authFile: string, providerId: string): boolean {
  if (!existsSync(authFile)) return false;
  const auth = JSON.parse(readFileSync(authFile, "utf8")) as Record<string, { type?: string }>;
  const entry = auth[providerId];
  return entry !== undefined && entry.type !== "apiKey";
}

function persistOnboardingConfig(runtime: RuntimeState, state: OnboardingState): void {
  updateUserConfig(runtime.paths.configFile, (config) => ({
    ...config,
    sandbox: {
      ...config.sandbox,
      enabled: state.data.sandboxEnabled ?? config.sandbox?.enabled,
    },
    agent: {
      ...config.agent,
      provider: state.data.provider ?? config.agent?.provider,
      modelId: state.data.modelId ?? config.agent?.modelId,
    },
    gateway: {
      ...config.gateway,
      telegram: {
        ...config.gateway?.telegram,
        enabled: state.data.telegramEnabled ?? config.gateway?.telegram?.enabled,
        token: state.data.telegramToken ?? config.gateway?.telegram?.token,
        allowedUserIds: state.data.telegramAllowedUserIds ?? config.gateway?.telegram?.allowedUserIds,
      },
    },
  }));
}

export async function runOnboarding(runtime: RuntimeState): Promise<void> {
  const state = loadOnboardingState(runtime.paths) ?? createDefaultOnboardingState();

  if (state.step === "welcome") {
    console.log("Welcome to MiniOpenClaw. Let's do first-time setup.");
    state.step = "name";
    saveOnboardingState(runtime.paths, state);
  }

  if (state.step === "name") {
    state.data.name = await promptText("What should I call you?");
    await appendContextEntryIfMissing(runtime.paths.workspace, `My name is ${state.data.name}`);
    state.step = "sandbox_enabled";
    saveOnboardingState(runtime.paths, state);
  }

  if (state.step === "sandbox_enabled") {
    state.data.sandboxEnabled = await promptYesNo("Should bash command sandboxing be enabled?", true);
    state.step = "telegram_enabled";
    saveOnboardingState(runtime.paths, state);
  }

  if (state.step === "telegram_enabled") {
    state.data.telegramEnabled = await promptYesNo("Do you want to set up Telegram now?", false);
    state.step = state.data.telegramEnabled ? "telegram_token" : "provider";
    saveOnboardingState(runtime.paths, state);
  }

  if (state.step === "telegram_token") {
    state.data.telegramToken = await promptText("Enter your Telegram bot token:");
    state.step = "telegram_allowed_users";
    saveOnboardingState(runtime.paths, state);
  }

  if (state.step === "telegram_allowed_users") {
    const value = await promptText("Enter allowed Telegram user ids (comma-separated, optional):");
    state.data.telegramAllowedUserIds = value ? value.split(",").map((part) => part.trim()).filter(Boolean) : [];
    state.step = "provider";
    saveOnboardingState(runtime.paths, state);
  }

  if (state.step === "provider") {
    const providerOptions = getProviderOptions();
    const selectedProviderName = await promptSelect("Select an OAuth provider:", providerOptions.map((provider) => provider.name));
    state.data.provider = providerOptions.find((provider) => provider.name === selectedProviderName)?.id;
    if (!state.data.provider) {
      throw new Error("Onboarding could not resolve the selected provider.");
    }
    state.step = "model";
    saveOnboardingState(runtime.paths, state);
  }

  if (state.step === "model") {
    if (!state.data.provider) {
      throw new Error("Onboarding is missing the selected provider.");
    }
    const modelIds = getModelIds(runtime, state.data.provider);
    if (modelIds.length === 0) {
      throw new Error(`No models available for provider ${state.data.provider}.`);
    }
    state.data.modelId = await promptSelect("Select a model:", modelIds);
    state.step = "auth";
    saveOnboardingState(runtime.paths, state);
  }

  if (state.step === "auth") {
    if (!state.data.provider) {
      throw new Error("Onboarding is missing the selected provider.");
    }

    const oauthProvider = getOAuthProviders().find((provider) => provider.id === state.data.provider);
    if (!oauthProvider) {
      throw new Error(`Provider ${state.data.provider} is not available for OAuth onboarding.`);
    }

    if (hasOAuthAuthForProvider(runtime.paths.authFile, state.data.provider)) {
      console.log(`Authentication for "${state.data.provider}" is already configured.`);
    } else {
      process.stdin.resume();
      await runOAuthLogin(oauthProvider, runtime.paths.authFile);
    }

    state.step = "review";
    saveOnboardingState(runtime.paths, state);
  }

  if (state.step === "review") {
    console.log("Onboarding summary:");
    console.log(`- Name: ${state.data.name ?? "(unset)"}`);
    console.log(`- Sandbox enabled: ${String(state.data.sandboxEnabled)}`);
    console.log(`- Provider: ${state.data.provider ?? "(unset)"}`);
    console.log(`- Model: ${state.data.modelId ?? "(unset)"}`);
    console.log(`- Telegram enabled: ${String(state.data.telegramEnabled ?? false)}`);
    persistOnboardingConfig(runtime, state);
    state.step = "done";
    state.completed = true;
    saveOnboardingState(runtime.paths, state);
  }
}
