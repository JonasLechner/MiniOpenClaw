import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeState } from "../src/core/runtime.js";

const getModelsMock = vi.fn();
const getProvidersMock = vi.fn();
const getOAuthProvidersMock = vi.fn();
const runOAuthLoginMock = vi.fn();
const saveApiKeyAuthMock = vi.fn();
const summarizeOnboardingProfileMock = vi.fn();
const readOnboardingFileMock = vi.fn();
const promptTextMock = vi.fn();
const promptYesNoMock = vi.fn();
const promptSelectMock = vi.fn();
const promptMultilineTextMock = vi.fn();

vi.mock("@earendil-works/pi-ai", () => ({
  getModels: getModelsMock,
  getProviders: getProvidersMock,
}));

vi.mock("@earendil-works/pi-ai/oauth", () => ({
  getOAuthProviders: getOAuthProvidersMock,
}));

vi.mock("../src/agent/auth.js", () => ({
  runOAuthLogin: runOAuthLoginMock,
  saveApiKeyAuth: saveApiKeyAuthMock,
}));

vi.mock("../src/onboarding/profile.js", () => ({
  summarizeOnboardingProfile: summarizeOnboardingProfileMock,
}));

vi.mock("../src/onboarding/context.js", async () => {
  const actual = await vi.importActual<typeof import("../src/onboarding/context.js")>("../src/onboarding/context.js");
  return {
    ...actual,
    readOnboardingFile: readOnboardingFileMock,
  };
});

vi.mock("../src/onboarding/cli.js", () => ({
  printHeading: vi.fn(),
  printSummaryItem: vi.fn(),
  promptText: promptTextMock,
  promptYesNo: promptYesNoMock,
  promptSelect: promptSelectMock,
  promptMultilineText: promptMultilineTextMock,
}));

describe("onboarding runner", () => {
  let root: string;
  let runtime: RuntimeState;
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    root = mkdtempSync(join(tmpdir(), "miniopenclaw-onboarding-runner-"));
    runtime = {
      config: {
        gateway: {
          host: "127.0.0.1",
          port: 3000,
          telegram: { enabled: false, token: undefined, polling: true, allowedUserIds: [] },
        },
        agent: { provider: undefined, modelId: undefined, reasoning: undefined, availableModels: undefined },
        sandbox: {
          enabled: true,
          engine: "auto",
          image: "miniopenclaw-sandbox:local",
          network: "none",
          memoryMb: undefined,
          cpus: undefined,
          pidsLimit: undefined,
        },
        logging: { level: "info" },
      },
      paths: {
        home: root,
        configFile: join(root, "config.json"),
        authFile: join(root, "auth.json"),
        sessions: join(root, "sessions"),
        workspace: join(root, "workspace"),
        memory: join(root, "workspace", "memory"),
        conversationBindings: join(root, "conversation-bindings.json"),
        scheduledTasks: join(root, "scheduled-tasks.json"),
      },
    };

    mkdirSync(runtime.paths.workspace, { recursive: true });
    writeFileSync(runtime.paths.authFile, JSON.stringify({ openai: { type: "apiKey", apiKey: "sk-test" } }), "utf8");
    getProvidersMock.mockReturnValue(["openai"]);
    getOAuthProvidersMock.mockReturnValue([
      { id: "openai-codex", name: "ChatGPT Plus/Pro (Codex Subscription)" },
      { id: "github-copilot", name: "GitHub Copilot" },
      { id: "anthropic", name: "Anthropic" },
    ]);
    getModelsMock.mockReturnValue([{ id: "gpt-test" }]);
    promptTextMock.mockResolvedValue("Sepp");
    promptYesNoMock.mockResolvedValue(false);
    promptSelectMock
      .mockResolvedValueOnce("Use an API key")
      .mockResolvedValueOnce("openai")
      .mockResolvedValueOnce("gpt-test");
    promptMultilineTextMock.mockResolvedValue("I like concise answers.");
    readOnboardingFileMock.mockResolvedValue("");
    summarizeOnboardingProfileMock.mockResolvedValue({
      userMarkdown: "# User\n- concise",
      contextMarkdown: "# Context\n- uses MiniOpenClaw for projects",
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("uses the selected provider and model for profile summarization", async () => {
    const { runOnboarding } = await import("../src/onboarding/runner.js");

    await runOnboarding(runtime);

    expect(summarizeOnboardingProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          agent: expect.objectContaining({ provider: "openai", modelId: "gpt-test" }),
        }),
      }),
      "Sepp",
      "I like concise answers.",
      {
        userMarkdown: "",
        contextMarkdown: "",
      },
    );

    const persisted = JSON.parse(readFileSync(runtime.paths.configFile, "utf8")) as Record<string, unknown>;
    expect(persisted).toMatchObject({
      agent: { provider: "openai", modelId: "gpt-test" },
    });
  });

  it("persists config and logs recovery guidance when profile summarization fails", async () => {
    summarizeOnboardingProfileMock.mockRejectedValueOnce(new Error("summary boom"));

    const { runOnboarding } = await import("../src/onboarding/runner.js");

    await expect(runOnboarding(runtime)).rejects.toThrow("summary boom");

    const persisted = JSON.parse(readFileSync(runtime.paths.configFile, "utf8")) as Record<string, unknown>;
    expect(persisted).toMatchObject({
      agent: { provider: "openai", modelId: "gpt-test" },
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith("\nI couldn't generate your profile summary.");
    expect(consoleErrorSpy).toHaveBeenCalledWith("summary boom");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("You can try again with `miniopenclaw onboard`, use different auth"),
    );
  });
});
