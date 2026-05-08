import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getModel } from "@earendil-works/pi-ai";
import {
  getOAuthApiKey,
  getOAuthProvider,
  type OAuthCredentials,
} from "@earendil-works/pi-ai/oauth";
import { initializeRuntime } from "../lib/runtime.js";

export type AgentModelSelection = {
  provider: string;
  modelId: string;
};

export type AgentAuth = AgentModelSelection & {
  model: ReturnType<typeof getModel>;
  apiKey: string;
};

type ApiKeyCredentials = {
  type: "apiKey";
  apiKey: string;
};

type OAuthAuthEntry = OAuthCredentials & {
  type?: "oauth";
};

type AuthEntry = ApiKeyCredentials | OAuthAuthEntry;

type AuthFile = Record<string, AuthEntry>;

export function pickProviderAndModel(): AgentModelSelection {
  const runtime = initializeRuntime();
  const provider = runtime.config.agent?.provider;
  const modelId = runtime.config.agent?.modelId;

  if (!provider || !modelId) {
    console.error(`Set agent.provider and agent.modelId in ${runtime.paths.configFile}.`);
    process.exit(1);
  }

  return { provider, modelId };
}

function loadAuthFile(path: string): AuthFile {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as AuthFile;
}

function saveAuthFile(path: string, auth: AuthFile): void {
  writeFileSync(path, `${JSON.stringify(auth, null, 2)}\n`, "utf8");
}

function isApiKeyCredentials(value: AuthEntry | undefined): value is ApiKeyCredentials {
  return value?.type === "apiKey";
}

function isOAuthCredentials(value: AuthEntry | undefined): value is OAuthAuthEntry {
  return value !== undefined && value.type !== "apiKey";
}

async function resolveApiKey(provider: string, authPath: string): Promise<string | undefined> {
  const auth = loadAuthFile(authPath);
  const providerAuth = auth[provider];

  if (!getOAuthProvider(provider)) {
    if (!providerAuth) return undefined;
    if (!isApiKeyCredentials(providerAuth)) {
      throw new Error(
        `Invalid auth entry for provider "${provider}" in ${authPath}: expected { "type": "apiKey", "apiKey": "..." }.`
      );
    }
    if (!providerAuth.apiKey) {
      throw new Error(`Invalid auth entry for provider "${provider}" in ${authPath}: apiKey must be a non-empty string.`);
    }

    return providerAuth.apiKey;
  }

  if (providerAuth !== undefined && !isOAuthCredentials(providerAuth)) {
    throw new Error(
      `Invalid auth entry for provider "${provider}" in ${authPath}: OAuth providers cannot use type "apiKey".`
    );
  }

  const oauth = await getOAuthApiKey(provider, auth as Record<string, OAuthCredentials>);
  if (!oauth) return undefined;

  auth[provider] = {
    ...oauth.newCredentials,
    type: "oauth",
  };
  saveAuthFile(authPath, auth);

  return oauth.apiKey;
}

export async function resolveAgentAuth(): Promise<AgentAuth> {
  const runtime = initializeRuntime();
  const { provider, modelId } = pickProviderAndModel();

  const model = getModel(provider as Parameters<typeof getModel>[0], modelId as Parameters<typeof getModel>[1]);
  const apiKey = await resolveApiKey(provider, runtime.paths.authFile);

  if (!apiKey) {
    console.error(`No auth found for provider "${provider}".`);
    if (getOAuthProvider(provider)) {
      console.error(`Complete OAuth or copy OAuth credentials into ${runtime.paths.authFile}`);
    } else {
      console.error(
        `Add { "type": "apiKey", "apiKey": "..." } for provider "${provider}" in ${runtime.paths.authFile}`
      );
    }
    process.exit(1);
  }

  return {
    provider,
    modelId,
    model,
    apiKey,
  };
}
