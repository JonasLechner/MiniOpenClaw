import { expect, test, vi } from "vitest";

const needsOnboardingMock = vi.fn();

vi.mock("../src/core/onboarding.js", () => ({
  needsOnboarding: needsOnboardingMock,
}));

vi.mock("../src/agent/auth.js", () => ({
  checkAuthAvailable: vi.fn(() => true),
}));

vi.mock("../src/core/runtime.js", () => ({
  initializeRuntime: vi.fn(),
}));

vi.mock("../src/core/sessions.js", () => ({
  ensureCurrentSession: vi.fn(),
}));

vi.mock("../src/sandbox/factory.js", () => ({
  createSandboxFactory: vi.fn(),
  resolveSandboxEngineKind: vi.fn(),
}));

vi.mock("../src/sandbox/sandbox.js", () => ({
  getSharedSandboxId: vi.fn(),
}));

vi.mock("../src/gateway/app.js", () => ({
  buildGateway: vi.fn(),
}));

test("gateway refuses startup when onboarding is incomplete", async () => {
  const { ensureGatewayOnboardingComplete } = await import("../src/gateway/index.js");
  const runtime = { paths: {} } as never;

  needsOnboardingMock.mockReturnValue(true);
  expect(() => ensureGatewayOnboardingComplete(runtime)).toThrow(/Run miniopenclaw onboard/);
});

test("gateway allows startup when onboarding is complete", async () => {
  const { ensureGatewayOnboardingComplete } = await import("../src/gateway/index.js");
  const runtime = { paths: {} } as never;

  needsOnboardingMock.mockReturnValue(false);
  expect(() => ensureGatewayOnboardingComplete(runtime)).not.toThrow();
});
