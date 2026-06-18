import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

let home: string | undefined;

afterEach(() => {
  if (home) {
    rmSync(home, { recursive: true, force: true });
    home = undefined;
  }
  vi.resetModules();
  vi.doUnmock("node:os");
});

async function mockHome(): Promise<void> {
  home = mkdtempSync(join(tmpdir(), "miniopenclaw-config-test-"));
  vi.doMock("node:os", async () => {
    const actual = await vi.importActual<typeof import("node:os")>("node:os");
    return {
      ...actual,
      homedir: () => home as string,
    };
  });
}

it("defaults sandboxing to enabled for new config files", async () => {
  await mockHome();

  const { loadRuntimeConfig } = await import("../src/core/config.js");
  const runtime = loadRuntimeConfig();

  expect(runtime.config.sandbox.enabled).toBe(true);
  expect(runtime.config.sandbox.engine).toBe("auto");
  expect(runtime.config.sandbox.image).toBe("miniopenclaw-sandbox:local");
  expect(runtime.config.sandbox.network).toBe("default");
  const persisted = JSON.parse(readFileSync(runtime.paths.configFile, "utf8")) as {
    sandbox?: { enabled?: boolean; image?: string; network?: string };
  };
  expect(persisted.sandbox?.enabled).toBe(true);
  expect(persisted.sandbox?.image).toBe("miniopenclaw-sandbox:local");
  expect(persisted.sandbox?.network).toBe("default");
});

it("accepts agent.availableModels and exposes it in resolved config", async () => {
  await mockHome();

  const configDir = join(home as string, ".mini-openclaw");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), `${JSON.stringify({
    agent: {
      provider: "github-copilot",
      modelId: "gpt-5.4-mini",
      availableModels: {
        "github-copilot": ["gpt-5.4-mini"],
        "openai-codex": ["gpt-5.4", "gpt-5.4-mini"],
      },
    },
  }, null, 2)}\n`, "utf8");

  const { loadRuntimeConfig } = await import("../src/core/config.js");
  const runtime = loadRuntimeConfig();

  expect(runtime.config.agent.availableModels).toEqual({
    "github-copilot": ["gpt-5.4-mini"],
    "openai-codex": ["gpt-5.4", "gpt-5.4-mini"],
  });
});

it("rejects agent.modelId values not listed for the configured provider", async () => {
  await mockHome();

  const configDir = join(home as string, ".mini-openclaw");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), `${JSON.stringify({
    agent: {
      provider: "github-copilot",
      modelId: "gpt-5.4",
      availableModels: {
        "github-copilot": ["gpt-5.4-mini"],
      },
    },
  }, null, 2)}\n`, "utf8");

  const { loadRuntimeConfig } = await import("../src/core/config.js");

  expect(() => loadRuntimeConfig()).toThrow(`agent.modelId must be listed in agent.availableModels.github-copilot.`);
});

it("updateUserConfig persists config updates", async () => {
  await mockHome();

  const { loadRuntimeConfig, updateUserConfig } = await import("../src/core/config.js");
  const runtime = loadRuntimeConfig();

  updateUserConfig(runtime.paths.configFile, (config) => ({
    ...config,
    sandbox: {
      ...config.sandbox,
      enabled: false,
    },
    agent: {
      ...config.agent,
      provider: "openai",
      modelId: "gpt-test",
    },
  }));

  const persisted = JSON.parse(readFileSync(runtime.paths.configFile, "utf8")) as {
    sandbox?: { enabled?: boolean };
    agent?: { provider?: string; modelId?: string };
  };
  expect(persisted.sandbox?.enabled).toBe(false);
  expect(persisted.agent?.provider).toBe("openai");
  expect(persisted.agent?.modelId).toBe("gpt-test");
});

it("wraps malformed JSON errors with the config file path", async () => {
  await mockHome();

  const configDir = join(home as string, ".mini-openclaw");
  mkdirSync(configDir, { recursive: true });
  const configFile = join(configDir, "config.json");
  writeFileSync(configFile, "{\n  invalid\n", "utf8");

  const { loadRuntimeConfig } = await import("../src/core/config.js");

  expect(() => loadRuntimeConfig()).toThrow(`Invalid config file at ${configFile}:`);
});

it("rejects logging set to null", async () => {
  await mockHome();

  const configDir = join(home as string, ".mini-openclaw");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), `${JSON.stringify({ logging: null }, null, 2)}\n`, "utf8");

  const { loadRuntimeConfig } = await import("../src/core/config.js");

  expect(() => loadRuntimeConfig()).toThrow("logging must be an object.");
});

it("defaults logging.file to true and allows disabling it", async () => {
  await mockHome();

  const { loadRuntimeConfig } = await import("../src/core/config.js");
  const runtime = loadRuntimeConfig();

  expect(runtime.config.logging.file).toBe(true);

  writeFileSync(runtime.paths.configFile, `${JSON.stringify({ logging: { file: false } }, null, 2)}\n`, "utf8");
  expect(loadRuntimeConfig().config.logging.file).toBe(false);
});

it("rejects non-boolean logging.file", async () => {
  await mockHome();

  const configDir = join(home as string, ".mini-openclaw");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), `${JSON.stringify({ logging: { file: "yes" } }, null, 2)}\n`, "utf8");

  const { loadRuntimeConfig } = await import("../src/core/config.js");

  expect(() => loadRuntimeConfig()).toThrow("logging.file must be a boolean.");
});


