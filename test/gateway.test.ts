import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimePaths } from "../src/core/config.js";
import type { RuntimeState } from "../src/core/runtime.js";
import { appendUserMessageEvent, createNewSession, ensureCurrentSession } from "../src/core/sessions.js";

const runtimeStateMock = vi.fn<() => RuntimeState>();
const schedulerStartMock = vi.fn();
const schedulerStopMock = vi.fn();

vi.mock("../src/core/runtime.js", () => ({
  initializeRuntime: runtimeStateMock,
}));

vi.mock("../src/jobs/scheduler.js", () => ({
  createGatewayScheduler: vi.fn(() => ({
    start: schedulerStartMock,
    stop: schedulerStopMock,
  })),
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
    conversationBindings: join(root, "conversation-bindings.json"),
    scheduledTasks: join(root, "scheduled-tasks.json"),
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
      logging: { level: "info" },
    },
    paths,
  });
});

describe("gateway session endpoints", () => {
  it("creates and returns a gateway-specific current session on first use", async () => {
    const tuiSession = await ensureCurrentSession(paths, "tui");

    const { buildGateway } = await import("../src/gateway/app.js");
    const app = buildGateway(runtimeStateMock());

    const response = await app.inject({ method: "GET", url: "/sessions/current" });
    expect(response.statusCode).toBe(200);

    const payload = response.json();
    expect(payload.sessionId).toBeTypeOf("string");
    expect(payload.sessionId).not.toBe(tuiSession.sessionId);
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]).toMatchObject({
      type: "system",
      name: "session_created",
      details: { reason: "first_use", surface: "gateway" },
    });

    await app.close();
  });

  it("renders the dashboard on / and saves config via /api/config", async () => {
    writeFileSync(paths.configFile, '{"gateway":{"port":3000}}\n', "utf8");

    const { buildGateway } = await import("../src/gateway/app.js");
    const app = buildGateway(runtimeStateMock());

    const dashboardResponse = await app.inject({ method: "GET", url: "/" });
    expect(dashboardResponse.statusCode).toBe(200);
    expect(dashboardResponse.headers["content-type"]).toContain("text/html");
    expect(dashboardResponse.body).toContain("MiniOpenClaw dashboard");

    const saveResponse = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { raw: '{"gateway":{"port":4000}}' },
    });
    expect(saveResponse.statusCode).toBe(200);
    expect(saveResponse.json()).toMatchObject({ message: expect.stringContaining(paths.configFile) });

    expect(await import("node:fs/promises").then(({ readFile }) => readFile(paths.configFile, "utf8"))).toContain("4000");

    const restartResponse = await app.inject({ method: "POST", url: "/api/restart" });
    expect(restartResponse.statusCode).toBe(501);

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

    const eventsResponse = await app.inject({ method: "GET", url: `/sessions/${first.sessionId}/events` });
    expect(eventsResponse.statusCode).toBe(200);
    const eventsPayload = eventsResponse.json();
    expect(eventsPayload.sessionId).toBe(first.sessionId);
    expect(eventsPayload.events.some((event: { type: string }) => event.type === "user_message")).toBe(true);

    const missingResponse = await app.inject({ method: "GET", url: "/sessions/missing/events" });
    expect(missingResponse.statusCode).toBe(404);

    await app.close();
  });
});
