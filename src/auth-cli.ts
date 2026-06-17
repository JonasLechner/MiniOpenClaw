import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";
import { getProviders } from "@earendil-works/pi-ai";
import { getOAuthProviders } from "@earendil-works/pi-ai/oauth";
import { runOAuthLogin, saveApiKeyAuth } from "./agent/auth.js";
import { loadRuntimeConfig } from "./core/config.js";
import { promptSelect, promptText } from "./onboarding/cli.js";

function hasAuthForProvider(authFile: string, provider: string): boolean {
  if (!existsSync(authFile)) return false;
  const auth = JSON.parse(readFileSync(authFile, "utf8")) as Record<string, { type?: string; apiKey?: string }>;
  const entry = auth[provider];
  if (!entry) return false;
  if (entry.type === "apiKey") {
    return typeof entry.apiKey === "string" && entry.apiKey.length > 0;
  }
  return true;
}

const allowedOAuthProviderIds = new Set(["openai-codex", "github-copilot"]);

function getAllowedOAuthProviders() {
  return getOAuthProviders().filter((provider) => allowedOAuthProviderIds.has(provider.id));
}

function formatProviderLabel(providerId: string): string {
  const oauthProvider = getAllowedOAuthProviders().find((candidate) => candidate.id === providerId)
    ?? getOAuthProviders().find((candidate) => candidate.id === providerId);
  if (oauthProvider) {
    return oauthProvider.name;
  }

  return providerId;
}

function getOAuthProviderOrThrow(providerId: string) {
  const provider = getAllowedOAuthProviders().find((candidate) => candidate.id === providerId);
  if (!provider) {
    throw new Error(`Provider "${providerId}" is not an OAuth provider.`);
  }
  return provider;
}

function getApiKeyProviderIds(): string[] {
  return [...new Set(getProviders() as string[])].sort();
}

function getApiKeyProviderOrThrow(providerId: string): string {
  if (!getApiKeyProviderIds().includes(providerId)) {
    throw new Error(`Provider "${providerId}" does not support configured models in pi-ai.`);
  }
  return providerId;
}

type AuthMethod = "oauth" | "apiKey";

function parseAuthMethod(value: string): AuthMethod {
  if (value === "oauth" || value === "subscription") {
    return "oauth";
  }
  if (value === "api-key" || value === "apikey" || value === "apiKey") {
    return "apiKey";
  }
  throw new Error(`Unknown authentication method: ${value}`);
}

async function selectProvider(argv: string[], authMethod: AuthMethod): Promise<string> {
  const explicitProvider = argv[0];
  if (explicitProvider) {
    return authMethod === "oauth"
      ? getOAuthProviderOrThrow(explicitProvider).id
      : getApiKeyProviderOrThrow(explicitProvider);
  }

  if (process.stdin.isTTY && process.stdout.isTTY) {
    if (authMethod === "oauth") {
      const providers = getAllowedOAuthProviders();
      if (providers.length === 0) {
        throw new Error("No OAuth providers available.");
      }
      const selectedName = await promptSelect("Select a provider:", providers.map((provider) => provider.name));
      const selectedProvider = providers.find((provider) => provider.name === selectedName);
      if (!selectedProvider) {
        throw new Error("Could not resolve selected OAuth provider.");
      }
      return selectedProvider.id;
    }

    const providerIds = getApiKeyProviderIds();
    const selectedLabel = await promptSelect("Select a provider:", providerIds.map(formatProviderLabel));
    const selectedProviderId = providerIds.find((providerId) => formatProviderLabel(providerId) === selectedLabel);
    if (!selectedProviderId) {
      throw new Error("Could not resolve selected API-key provider.");
    }
    return selectedProviderId;
  }

  throw new Error("Authentication requires an interactive TTY; no provider default is chosen. Re-run `npm run auth` in a terminal and select a provider, or pass a provider id explicitly.");
}

async function selectAuthMethod(argv: string[]): Promise<AuthMethod> {
  const explicitMethod = argv[1];
  if (explicitMethod) {
    return parseAuthMethod(explicitMethod);
  }

  if (process.stdin.isTTY && process.stdout.isTTY) {
    const selected = await promptSelect("Select authentication method:", ["Use a subscription", "Use an API key (not officially supported)"]);
    return selected === "Use an API key (not officially supported)" ? "apiKey" : "oauth";
  }

  return "oauth";
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const runtime = loadRuntimeConfig();
  const authMethod = await selectAuthMethod(argv);
  const selectedProvider = await selectProvider(argv, authMethod);

  const oauthProvider = authMethod === "oauth" ? getOAuthProviderOrThrow(selectedProvider) : undefined;

  if (hasAuthForProvider(runtime.paths.authFile, selectedProvider)) {
    console.log(`\nAuthentication for "${selectedProvider}" is already configured.`);
    console.log(`Delete ${runtime.paths.authFile} if you want to re-authenticate.`);
    process.exit(0);
  }

  if (authMethod === "apiKey") {
    const explicitApiKey = argv[2];
    if (explicitApiKey) {
      saveApiKeyAuth(selectedProvider, explicitApiKey, runtime.paths.authFile);
      console.log(`Authentication saved to ${runtime.paths.authFile}`);
      return;
    }

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error("API-key authentication requires an interactive TTY, or pass the key explicitly as `npm run auth -- <provider> api-key <key>`. ");
    }

    const apiKey = await promptText(`Enter API key for ${formatProviderLabel(selectedProvider)}:`);
    saveApiKeyAuth(selectedProvider, apiKey, runtime.paths.authFile);
    console.log(`Authentication saved to ${runtime.paths.authFile}`);
    return;
  }

  if (!oauthProvider) {
    throw new Error(`Provider "${selectedProvider}" is not an OAuth provider.`);
  }

  await runOAuthLogin(oauthProvider, runtime.paths.authFile);
}

const isEntrypoint = basename(process.argv[1] ?? "") === basename(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
