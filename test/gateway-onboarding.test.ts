import { expect, test, vi } from "vitest";

const needsOnboardingMock = vi.fn();

vi.mock("../src/core/onboarding.js", () => ({
  needsOnboarding: needsOnboardingMock,
}));

test("gateway refuses startup when onboarding is incomplete", async () => {
  const { ensureGatewayOnboardingComplete } = await import("../src/gateway/index.js");
  const runtime = { paths: {} } as never;

  needsOnboardingMock.mockReturnValue(true);
  expect(() => ensureGatewayOnboardingComplete(runtime)).toThrow(/Run npm run start:agent/);
});

test("gateway allows startup when onboarding is complete", async () => {
  const { ensureGatewayOnboardingComplete } = await import("../src/gateway/index.js");
  const runtime = { paths: {} } as never;

  needsOnboardingMock.mockReturnValue(false);
  expect(() => ensureGatewayOnboardingComplete(runtime)).not.toThrow();
});
