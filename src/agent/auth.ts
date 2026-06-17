import { createReadStream } from "node:fs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { getModel } from "@earendil-works/pi-ai";
import {
  getOAuthApiKey,
  getOAuthProvider,
  type OAuthCredentials,
  type OAuthProviderInterface,
} from "@earendil-works/pi-ai/oauth";
import type { RuntimeState } from "../core/runtime.js";

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

export class AgentAuthError extends Error {}

export function checkAuthAvailable(runtime: RuntimeState): boolean {
  const provider = runtime.config.agent.provider;
  if (!provider) return false;

  const auth = loadAuthFile(runtime.paths.authFile);
  const entry = auth[provider];

  if (isApiKeyCredentials(entry)) {
    return !!entry.apiKey;
  }

  if (!getOAuthProvider(provider)) {
    return false;
  }

  return isOAuthCredentials(entry);
}

export function pickProviderAndModel(runtime: RuntimeState): AgentModelSelection {
  const provider = runtime.config.agent.provider;
  const modelId = runtime.config.agent.modelId;

  if (!provider || !modelId) {
    throw new AgentAuthError(`Set agent.provider and agent.modelId in ${runtime.paths.configFile}.`);
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

function readLine(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    let input: NodeJS.ReadableStream;
    try {
      input = createReadStream("/dev/tty");
    } catch {
      input = process.stdin;
    }
    const rl = createInterface({ input, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function saveApiKeyAuth(provider: string, apiKey: string, authPath: string): void {
  const normalizedApiKey = apiKey.trim();
  if (!normalizedApiKey) {
    throw new Error("API key must be a non-empty string.");
  }

  const auth = loadAuthFile(authPath);
  auth[provider] = { type: "apiKey", apiKey: normalizedApiKey };
  saveAuthFile(authPath, auth);
}

export async function runOAuthLogin(provider: OAuthProviderInterface, authPath: string): Promise<OAuthCredentials> {
  console.log(`\nAuthenticating with ${provider.name}...`);

  const credentials = await provider.login({
    onAuth: (info) => {
      console.log(`\nPlease open this URL in your browser to authenticate:\n  ${info.url}`);
      if (info.instructions) {
        console.log(`\n${info.instructions}`);
      }
    },
    onPrompt: async (prompt) => {
      const answer = await readLine(`\n${prompt.message}${prompt.placeholder ? ` (${prompt.placeholder})` : ""}: `);
      return answer;
    },
    onProgress: (message) => {
      console.log(`  ${message}`);
    },
  });

  const auth = loadAuthFile(authPath);
  auth[provider.id] = { ...credentials, type: "oauth" };
  saveAuthFile(authPath, auth);

  console.log(`Authentication saved to ${authPath}\n`);
  return credentials;
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

  if (isApiKeyCredentials(providerAuth)) {
    if (!providerAuth.apiKey) {
      throw new Error(`Invalid auth entry for provider "${provider}" in ${authPath}: apiKey must be a non-empty string.`);
    }

    return providerAuth.apiKey;
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

export async function resolveAgentAuth(runtime: RuntimeState): Promise<AgentAuth> {
  const { provider, modelId } = pickProviderAndModel(runtime);

  const model = getModel(provider as Parameters<typeof getModel>[0], modelId as Parameters<typeof getModel>[1]);
  const apiKey = await resolveApiKey(provider, runtime.paths.authFile);

  if (!apiKey) {
    if (getOAuthProvider(provider)) {
      throw new AgentAuthError(
        `No auth found for provider "${provider}". Run "npm run auth" to authenticate interactively, or add OAuth credentials or { "type": "apiKey", "apiKey": "..." } to ${runtime.paths.authFile}.`,
      );
    }
    throw new AgentAuthError(
      `No auth found for provider "${provider}". Add { "type": "apiKey", "apiKey": "..." } in ${runtime.paths.authFile}`,
    );
  }

  return {
    provider,
    modelId,
    model,
    apiKey,
  };
}
