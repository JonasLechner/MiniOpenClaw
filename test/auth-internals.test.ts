import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeState } from "../src/core/runtime.js";

const getModelMock = vi.fn(() => ({ id: "mock-model" }));
const getOAuthProviderMock = vi.fn();
const getOAuthApiKeyMock = vi.fn();

vi.mock("@earendil-works/pi-ai", () => ({
  getModel: getModelMock,
}));

vi.mock("@earendil-works/pi-ai/oauth", () => ({
  getOAuthProvider: getOAuthProviderMock,
  getOAuthApiKey: getOAuthApiKeyMock,
}));

function createRuntime(authFile: string, configFile: string): RuntimeState {
  return {
    config: {
      gateway: {
        host: "127.0.0.1",
        port: 3000,
        telegram: { enabled: false, token: undefined, polling: true, allowedUserIds: [] },
      },
      agent: { provider: "openai", modelId: "gpt-test", reasoning: undefined },
      sandbox: {
        enabled: true,
        engine: "auto",
        image: "miniopenclaw-sandbox:local",
        network: "none",
        memoryMb: undefined,
        cpus: undefined,
        pidsLimit: undefined,
      },
    },
    paths: {
      home: join(configFile, ".."),
      configFile,
      authFile,
      sessions: join(configFile, "../sessions"),
      workspace: join(configFile, "../workspace"),
      memory: join(configFile, "../workspace/memory"),
      conversationBindings: join(configFile, "../conversation-bindings.json"),
      scheduledTasks: join(configFile, "../scheduled-tasks.json"),
    },
  };
}

describe("agent auth internals", () => {
  let root: string;
  let authFile: string;
  let configFile: string;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    root = mkdtempSync(join(tmpdir(), "miniopenclaw-auth-test-"));
    authFile = join(root, "auth.json");
    configFile = join(root, "config.json");
    writeFileSync(configFile, "{}\n", "utf8");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("checkAuthAvailable returns true for API-key providers with a valid auth entry", async () => {
    getOAuthProviderMock.mockReturnValue(undefined);
    writeFileSync(authFile, JSON.stringify({ openai: { type: "apiKey", apiKey: "sk-test" } }), "utf8");
    const runtime = createRuntime(authFile, configFile);

    const { checkAuthAvailable } = await import("../src/agent/auth.js");
    expect(checkAuthAvailable(runtime)).toBe(true);
  });

  it("checkAuthAvailable returns false for missing provider or invalid entry type", async () => {
    getOAuthProviderMock.mockReturnValue(undefined);
    writeFileSync(authFile, JSON.stringify({ openai: { accessToken: "oauth-token" } }), "utf8");
    const runtime = createRuntime(authFile, configFile);

    const { checkAuthAvailable } = await import("../src/agent/auth.js");
    expect(checkAuthAvailable({ ...runtime, config: { ...runtime.config, agent: { ...runtime.config.agent, provider: undefined } } })).toBe(false);
    expect(checkAuthAvailable(runtime)).toBe(false);
  });

  it("pickProviderAndModel fails when provider or model is missing", async () => {
    const runtime = createRuntime(authFile, configFile);
    const { pickProviderAndModel } = await import("../src/agent/auth.js");

    expect(() => pickProviderAndModel({
      ...runtime,
      config: { ...runtime.config, agent: { provider: "openai", modelId: undefined, reasoning: undefined } },
    })).toThrow(`Set agent.provider and agent.modelId in ${configFile}.`);
  });

  it("resolveAgentAuth returns API-key credentials for non-OAuth providers", async () => {
    getOAuthProviderMock.mockReturnValue(undefined);
    writeFileSync(authFile, JSON.stringify({ openai: { type: "apiKey", apiKey: "sk-test" } }), "utf8");
    const runtime = createRuntime(authFile, configFile);

    const { resolveAgentAuth } = await import("../src/agent/auth.js");
    const auth = await resolveAgentAuth(runtime);

    expect(getModelMock).toHaveBeenCalledWith("openai", "gpt-test");
    expect(auth).toMatchObject({
      provider: "openai",
      modelId: "gpt-test",
      apiKey: "sk-test",
      model: { id: "mock-model" },
    });
  });

  it("resolveAgentAuth refreshes and persists OAuth credentials", async () => {
    getOAuthProviderMock.mockReturnValue({ id: "openai-codex" });
    getOAuthApiKeyMock.mockResolvedValue({
      apiKey: "oauth-api-key",
      newCredentials: { accessToken: "new-token", refreshToken: "refresh" },
    });
    writeFileSync(authFile, JSON.stringify({ "openai-codex": { accessToken: "old-token", refreshToken: "old-refresh" } }), "utf8");
    const runtime = {
      ...createRuntime(authFile, configFile),
      config: { ...createRuntime(authFile, configFile).config, agent: { provider: "openai-codex", modelId: "gpt-test", reasoning: undefined } },
    };

    const { resolveAgentAuth } = await import("../src/agent/auth.js");
    const auth = await resolveAgentAuth(runtime);

    expect(auth.apiKey).toBe("oauth-api-key");
    const persisted = JSON.parse(readFileSync(authFile, "utf8")) as Record<string, Record<string, string>>;
    expect(persisted["openai-codex"]).toMatchObject({
      type: "oauth",
      accessToken: "new-token",
      refreshToken: "refresh",
    });
  });

  it("resolveAgentAuth rejects invalid auth entry shapes", async () => {
    getOAuthProviderMock.mockReturnValue(undefined);
    writeFileSync(authFile, JSON.stringify({ openai: { accessToken: "wrong-shape" } }), "utf8");
    const runtime = createRuntime(authFile, configFile);

    const { resolveAgentAuth } = await import("../src/agent/auth.js");
    await expect(resolveAgentAuth(runtime)).rejects.toThrow('expected { "type": "apiKey", "apiKey": "..." }');
  });

  it("resolveAgentAuth rejects apiKey-style entries for OAuth providers", async () => {
    getOAuthProviderMock.mockReturnValue({ id: "openai-codex" });
    writeFileSync(authFile, JSON.stringify({ "openai-codex": { type: "apiKey", apiKey: "sk-wrong" } }), "utf8");
    const runtime = {
      ...createRuntime(authFile, configFile),
      config: { ...createRuntime(authFile, configFile).config, agent: { provider: "openai-codex", modelId: "gpt-test", reasoning: undefined } },
    };

    const { resolveAgentAuth } = await import("../src/agent/auth.js");
    await expect(resolveAgentAuth(runtime)).rejects.toThrow('OAuth providers cannot use type "apiKey"');
  });

  it("resolveAgentAuth reports missing OAuth auth clearly", async () => {
    getOAuthProviderMock.mockReturnValue({ id: "openai-codex" });
    getOAuthApiKeyMock.mockResolvedValue(undefined);
    const runtime = {
      ...createRuntime(authFile, configFile),
      config: { ...createRuntime(authFile, configFile).config, agent: { provider: "openai-codex", modelId: "gpt-test", reasoning: undefined } },
    };

    const { resolveAgentAuth } = await import("../src/agent/auth.js");
    await expect(resolveAgentAuth(runtime)).rejects.toThrow('Run "npm run auth"');
  });
});
