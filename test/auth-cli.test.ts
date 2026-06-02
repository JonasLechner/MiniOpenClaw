import { beforeEach, describe, expect, it, vi } from "vitest";

const getOAuthProvidersMock = vi.fn();
const runOAuthLoginMock = vi.fn();
const loadRuntimeConfigMock = vi.fn();

vi.mock("@earendil-works/pi-ai/oauth", () => ({
  getOAuthProviders: getOAuthProvidersMock,
}));

vi.mock("../src/agent/auth.js", () => ({
  runOAuthLogin: runOAuthLoginMock,
}));

vi.mock("../src/core/config.js", () => ({
  loadRuntimeConfig: loadRuntimeConfigMock,
}));

describe("auth cli", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getOAuthProvidersMock.mockReturnValue([
      { id: "openai-codex", name: "OpenAI Codex" },
      { id: "anthropic", name: "Anthropic" },
    ]);
    loadRuntimeConfigMock.mockReturnValue({
      config: {
        agent: { provider: "openai", modelId: "gpt-test" },
      },
      paths: {
        authFile: "/tmp/auth.json",
      },
    });
  });

  it("fails fast without a TTY when no explicit provider is supplied", async () => {
    vi.stubGlobal("process", {
      ...process,
      argv: ["node", "/tmp/auth-cli.js"],
      stdin: { ...process.stdin, isTTY: false },
      stdout: { ...process.stdout, isTTY: false },
    });

    const { main } = await import("../src/auth-cli.js");

    await expect(main([])).rejects.toThrow(
      "Authentication requires an interactive TTY; no provider default is chosen.",
    );
    expect(runOAuthLoginMock).not.toHaveBeenCalled();
  });

  it("uses an explicit OAuth provider argument instead of the configured provider", async () => {
    vi.stubGlobal("process", {
      ...process,
      argv: ["node", "/tmp/auth-cli.js"],
      stdin: { ...process.stdin, isTTY: false },
      stdout: { ...process.stdout, isTTY: false },
      exit: vi.fn(),
    });

    const { main } = await import("../src/auth-cli.js");

    await main(["anthropic"]);

    expect(runOAuthLoginMock).toHaveBeenCalledWith(
      { id: "anthropic", name: "Anthropic" },
      "/tmp/auth.json",
    );
  });

  it("rejects explicit providers that are not OAuth-backed", async () => {
    vi.stubGlobal("process", {
      ...process,
      argv: ["node", "/tmp/auth-cli.js"],
      stdin: { ...process.stdin, isTTY: false },
      stdout: { ...process.stdout, isTTY: false },
    });

    const { main } = await import("../src/auth-cli.js");

    await expect(main(["openai"])).rejects.toThrow('Provider "openai" is not an OAuth provider.');
    expect(runOAuthLoginMock).not.toHaveBeenCalled();
  });
});
