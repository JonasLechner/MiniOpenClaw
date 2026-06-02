import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimePaths } from "../src/lib/config.js";
import type { RuntimeState } from "../src/lib/runtime.js";
import { appendUserMessageEvent, createNewSession } from "../src/lib/sessions.js";

const runtimeStateMock = vi.fn<() => RuntimeState>();

vi.mock("../src/lib/runtime.js", () => ({
  initializeRuntime: runtimeStateMock,
}));

function createRuntimePaths(): RuntimePaths {
  const root = mkdtempSync(join(tmpdir(), "miniopenclaw-gateway-test-"));
  return {
    home: root,
    configFile: join(root, "config.json"),
    authFile: join(root, "auth.json"),
    sessions: join(root, "sessions"),
    workspace: join(root, "workspace"),
    memory: join(root, "workspace", "memory"),
  };
}

let paths: RuntimePaths;

afterEach(() => {
  rmSync(paths.home, { recursive: true, force: true });
  vi.clearAllMocks();
});

beforeEach(() => {
  paths = createRuntimePaths();
  runtimeStateMock.mockReturnValue({
    config: {
      gateway: { host: "127.0.0.1", port: 3000 },
      agent: { provider: "openai", modelId: "gpt-test" },
    },
    paths,
  });
});

describe("gateway session endpoints", () => {
  it("creates and returns the current session on first use", async () => {
    const { buildGateway } = await import("../src/gateway/app.js");
    const app = buildGateway(runtimeStateMock());

    const response = await app.inject({ method: "GET", url: "/sessions/current" });
    expect(response.statusCode).toBe(200);

    const payload = response.json();
    expect(payload.sessionId).toBeTypeOf("string");
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]).toMatchObject({ type: "system", name: "session_created" });

    await app.close();
  });

  it("lists sessions and returns events for a selected session", async () => {
    const first = await createNewSession(paths);
    await appendUserMessageEvent(first, "hello");

    const second = await createNewSession(paths);
    await appendUserMessageEvent(second, "newer");

    const { buildGateway } = await import("../src/gateway/app.js");
    const app = buildGateway(runtimeStateMock());

    const listResponse = await app.inject({ method: "GET", url: "/sessions" });
    expect(listResponse.statusCode).toBe(200);
    const listPayload = listResponse.json();
    expect(listPayload.sessions).toHaveLength(2);

    const eventsResponse = await app.inject({ method: "GET", url: `/sessions/${first.header.sessionId}/events` });
    expect(eventsResponse.statusCode).toBe(200);
    const eventsPayload = eventsResponse.json();
    expect(eventsPayload.sessionId).toBe(first.header.sessionId);
    expect(eventsPayload.events.some((event: { type: string }) => event.type === "user_message")).toBe(true);

    const missingResponse = await app.inject({ method: "GET", url: "/sessions/missing/events" });
    expect(missingResponse.statusCode).toBe(404);

    await app.close();
  });
});
