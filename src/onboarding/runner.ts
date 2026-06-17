import { getModels, getProviders, type KnownProvider } from "@earendil-works/pi-ai";
import { getOAuthProviders } from "@earendil-works/pi-ai/oauth";
import { runOAuthLogin, saveApiKeyAuth } from "../agent/auth.js";
import { updateUserConfig } from "../core/config.js";
import type { RuntimeState } from "../core/runtime.js";
import { readOnboardingFile } from "./context.js";
import { summarizeOnboardingProfile } from "./profile.js";
import { printHeading, printSummaryItem, promptMultilineText, promptSelect, promptText, promptYesNo } from "./cli.js";

type AuthMethod = "oauth" | "apiKey";

const allowedOAuthProviderIds = new Set(["openai-codex", "github-copilot"]);

function getAllowedOAuthProviders() {
  return getOAuthProviders().filter((provider) => allowedOAuthProviderIds.has(provider.id));
}

function formatProviderLabel(providerId: string): string {
  const oauthProvider = getAllowedOAuthProviders().find((candidate) => candidate.id === providerId)
    ?? getOAuthProviders().find((candidate) => candidate.id === providerId);
  return oauthProvider?.name ?? providerId;
}

function getProviderOptions(authMethod: AuthMethod): Array<{ id: string; name: string }> {
  if (authMethod === "oauth") {
    return getAllowedOAuthProviders().map((provider) => ({ id: provider.id, name: provider.name }));
  }

  return [...new Set(getProviders() as string[])]
    .sort()
    .map((providerId) => ({ id: providerId, name: formatProviderLabel(providerId) }));
}

function isSupportedCodexModel(modelId: string): boolean {
  const match = modelId.match(/(?:^|-)gpt-(\d+)(?:\.(\d+))?/);
  if (!match) return false;

  const major = Number(match[1]);
  const minor = Number(match[2] ?? "0");
  return major > 5 || (major === 5 && minor >= 4);
}

function filterProviderModels(providerId: string, modelIds: string[]): string[] {
  if (providerId !== "openai-codex") return modelIds;
  return modelIds.filter(isSupportedCodexModel);
}

function getModelIds(runtime: RuntimeState, providerId: string): string[] {
  const configured = runtime.config.agent.availableModels?.[providerId];
  if (configured && configured.length > 0) {
    return filterProviderModels(providerId, configured);
  }

  const models = getModels(providerId as KnownProvider).map((model) => model.id).sort();
  return filterProviderModels(providerId, [...new Set(models)]);
}

async function selectAuthMethod(): Promise<AuthMethod> {
  const selected = await promptSelect("Select authentication method:", ["Use a subscription", "Use an API key (not officially supported)"]);
  return selected === "Use an API key (not officially supported)" ? "apiKey" : "oauth";
}

type OnboardingDraft = {
  data: {
    name?: string;
    sandboxEnabled?: boolean;
    provider?: string;
    modelId?: string;
    aboutYou?: string;
    telegramEnabled?: boolean;
    telegramToken?: string;
    telegramAllowedUserIds?: string[];
  };
};

function persistOnboardingConfig(runtime: RuntimeState, state: OnboardingDraft): void {
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

  runtime.config = {
    ...runtime.config,
    sandbox: {
      ...runtime.config.sandbox,
      enabled: state.data.sandboxEnabled ?? runtime.config.sandbox.enabled,
    },
    agent: {
      ...runtime.config.agent,
      provider: state.data.provider ?? runtime.config.agent.provider,
      modelId: state.data.modelId ?? runtime.config.agent.modelId,
    },
    gateway: {
      ...runtime.config.gateway,
      telegram: {
        ...runtime.config.gateway.telegram,
        enabled: state.data.telegramEnabled ?? runtime.config.gateway.telegram.enabled,
        token: state.data.telegramToken ?? runtime.config.gateway.telegram.token,
        allowedUserIds: state.data.telegramAllowedUserIds ?? runtime.config.gateway.telegram.allowedUserIds,
      },
    },
  };
}

export async function runOnboarding(runtime: RuntimeState): Promise<void> {
  const state: OnboardingDraft = { data: {} };

  printHeading("Welcome to MiniOpenClaw");
  console.log("Let's do first-time setup.");

  state.data.name = await promptText("What should I call you?");
  state.data.sandboxEnabled = await promptYesNo("Should bash command sandboxing be enabled?", true);

  const existingTelegram = runtime.config.gateway.telegram;
  if (existingTelegram.enabled || existingTelegram.token || existingTelegram.allowedUserIds.length > 0) {
    console.log("Telegram is already configured.");
    const shouldChangeTelegram = await promptYesNo("Would you like to change the Telegram settings?", false);
    if (shouldChangeTelegram) {
      state.data.telegramEnabled = await promptYesNo("Should Telegram be enabled?", existingTelegram.enabled);
      if (state.data.telegramEnabled) {
        state.data.telegramToken = await promptText("Enter your Telegram bot token:");
        const value = await promptText("Enter allowed Telegram user ids (comma-separated, optional):");
        state.data.telegramAllowedUserIds = value ? value.split(",").map((part) => part.trim()).filter(Boolean) : [];
      }
    }
  } else {
    state.data.telegramEnabled = await promptYesNo("Do you want to set up Telegram now?", false);
    if (state.data.telegramEnabled) {
      state.data.telegramToken = await promptText("Enter your Telegram bot token:");
      const value = await promptText("Enter allowed Telegram user ids (comma-separated, optional):");
      state.data.telegramAllowedUserIds = value ? value.split(",").map((part) => part.trim()).filter(Boolean) : [];
    }
  }

  const authMethod = await selectAuthMethod();
  const providerOptions = getProviderOptions(authMethod);
  const selectedProviderName = await promptSelect("Select a provider:", providerOptions.map((provider) => provider.name));
  state.data.provider = providerOptions.find((provider) => provider.name === selectedProviderName)?.id;
  if (!state.data.provider) {
    throw new Error("Onboarding could not resolve the selected provider.");
  }

  const modelIds = getModelIds(runtime, state.data.provider);
  if (modelIds.length === 0) {
    throw new Error(`No models available for provider ${state.data.provider}.`);
  }
  state.data.modelId = await promptSelect("Select a model:", modelIds);

  if (authMethod === "apiKey") {
    const apiKey = await promptText(`Enter API key for ${formatProviderLabel(state.data.provider)}:`);
    saveApiKeyAuth(state.data.provider, apiKey, runtime.paths.authFile);
    console.log(`Authentication saved to ${runtime.paths.authFile}`);
  } else {
    const oauthProvider = getAllowedOAuthProviders().find((provider) => provider.id === state.data.provider);
    if (!oauthProvider) {
      throw new Error(`Provider ${state.data.provider} is not available for OAuth onboarding.`);
    }
    process.stdin.resume();
    await runOAuthLogin(oauthProvider, runtime.paths.authFile);
  }

  console.log("\nNext I'll ask a few questions for your profile and memory context.");
  state.data.aboutYou = await promptMultilineText(
    "Tell me a bit about yourself and how you'd like me to help. Useful things to include: what you want to use MiniOpenClaw for, the goals or projects you're focused on, and the tone or communication style you prefer from me."
  );

  persistOnboardingConfig(runtime, state);

  if (state.data.aboutYou) {
    const setupMessage = state.data.sandboxEnabled && runtime.config.sandbox.engine === "docker"
      ? "\nThanks — I'm setting up your profile and memory files now. This can take a bit longer when Docker sandboxing is selected.\nPlease wait..."
      : "\nThanks — I'm setting up your profile and memory files now.\nPlease wait...";
    console.log(setupMessage);

    try {
      await summarizeOnboardingProfile(runtime, state.data.name, state.data.aboutYou, {
        userMarkdown: await readOnboardingFile(runtime.paths.workspace, "user.md"),
        contextMarkdown: await readOnboardingFile(runtime.paths.workspace, "context.md"),
      });
    } catch (error) {
      const details = error instanceof Error ? ` Details: ${error.message}` : "";
      throw new Error(
        `I couldn't generate your profile summary because the onboarding LLM step failed. This usually means the selected provider or authentication isn't working yet. Please run \`miniopenclaw onboard\` again, or try a different provider/auth setup in ${runtime.paths.authFile}.${details}`,
        { cause: error },
      );
    }
  }

  printHeading("Onboarding summary");
  printSummaryItem("Name:", state.data.name ?? "(unset)");
  printSummaryItem("Sandbox enabled:", String(state.data.sandboxEnabled));
  printSummaryItem("Provider:", state.data.provider ?? "(unset)");
  printSummaryItem("Model:", state.data.modelId ?? "(unset)");
  printSummaryItem("Telegram enabled:", String(state.data.telegramEnabled ?? false));
  printSummaryItem("Profile notes:", state.data.aboutYou ? "saved to user.md and context.md" : "none");
}
