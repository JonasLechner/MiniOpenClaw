import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimePaths } from "../src/lib/config.js";
import type { RuntimeState } from "../src/lib/runtime.js";
import { getSessionById, listSessions } from "../src/lib/sessions.js";

const streamMock = vi.fn();
const runtimeStateMock = vi.fn<() => RuntimeState>();
const resolveAgentAuthMock = vi.fn();

vi.mock("@earendil-works/pi-ai", () => ({
  stream: streamMock,
  complete: vi.fn(),
  validateToolCall: vi.fn(),
  Type: {
    Object: (value: unknown) => value,
    String: () => ({ type: "string" }),
    Number: () => ({ type: "number" }),
    Boolean: () => ({ type: "boolean" }),
    Optional: (value: unknown) => value,
    Union: (value: unknown) => value,
    Literal: (value: unknown) => value,
  },
}));

vi.mock("../src/lib/runtime.js", () => ({
  initializeRuntime: runtimeStateMock,
}));

vi.mock("../src/agent/auth.js", () => ({
  resolveAgentAuth: resolveAgentAuthMock,
}));

function createRuntimePaths(): RuntimePaths {
  const root = mkdtempSync(join(tmpdir(), "miniopenclaw-loop-test-"));
  return {
    home: root,
    configFile: join(root, "config.json"),
    authFile: join(root, "auth.json"),
    sessions: join(root, "sessions"),
    workspace: join(root, "workspace"),
    memory: join(root, "workspace", "memory"),
  };
}

function createFakeEventStream() {
  const response = {
    role: "assistant" as const,
    content: [
      { type: "thinking" as const, thinking: "hidden chain" },
      { type: "text" as const, text: "Hello world" },
    ],
    api: "openai-responses" as const,
    provider: "openai",
    model: "gpt-test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };

  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "text_start" as const, contentIndex: 1, partial: response };
      yield { type: "text_delta" as const, contentIndex: 1, delta: "Hello ", partial: response };
      yield { type: "text_delta" as const, contentIndex: 1, delta: "world", partial: response };
      yield { type: "done" as const, reason: "stop" as const, message: response };
    },
    async result() {
      return response;
    },
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
  resolveAgentAuthMock.mockResolvedValue({
    provider: "openai",
    modelId: "gpt-test",
    model: { provider: "openai", id: "gpt-test" },
    apiKey: "test-key",
  });
  streamMock.mockImplementation(() => createFakeEventStream());
});

describe("createAgentLoop", () => {
  it("streams normalized deltas to the callback and persists the final assistant message", async () => {
    const { createAgentLoop } = await import("../src/agent/loop.js");
    const agent = await createAgentLoop();
    const seenDeltas: string[] = [];

    const result = await agent.runLoop("hello", {
      onEvent(event) {
        if (event.type === "message_delta") {
          seenDeltas.push(event.delta);
        }
      },
    });

    expect(seenDeltas).toEqual(["Hello ", "world"]);
    expect(result).toMatchObject({
      text: "Hello world",
      stopReason: "stop",
    });

    const [sessionSummary] = await listSessions(paths);
    expect(sessionSummary).toBeDefined();

    const session = await getSessionById(paths, sessionSummary!.sessionId);
    const assistantEvent = session?.events.find((event) => event.type === "assistant_message");
    expect(assistantEvent).toMatchObject({
      type: "assistant_message",
      visibleText: "Hello world",
      thinking: ["hidden chain"],
    });
  });

  it("creates a new session that becomes the current session", async () => {
    const { createAgentLoop } = await import("../src/agent/loop.js");
    const agent = await createAgentLoop();

    await agent.runLoop("first prompt");    const firstSessionId = (await listSessions(paths))[0]?.sessionId;

    const fresh = await agent.newSession();
    await agent.runLoop("second prompt");
    const sessions = await listSessions(paths);
    expect(sessions).toHaveLength(2);
    expect(fresh.sessionId).not.toBe(firstSessionId);
    expect(sessions[0]?.sessionId).toBe(fresh.sessionId);
    expect(sessions[1]?.sessionId).toBe(firstSessionId);
  });

  it("persists an error event and rethrows provider failures", async () => {
    const { createAgentLoop } = await import("../src/agent/loop.js");
    const agent = await createAgentLoop();

    streamMock.mockImplementationOnce(() => {
      throw new Error("provider offline");
    });

    await expect(agent.runLoop("hello")).rejects.toThrow("provider offline");
    const [sessionSummary] = await listSessions(paths);
    const session = await getSessionById(paths, sessionSummary!.sessionId);
    const errorEvent = session?.events.find((event) => event.type === "error");
    expect(errorEvent).toMatchObject({
      type: "error",
      message: "provider offline",
    });
  });

  it("exposes an Agent wrapper with persistent listeners", async () => {
    const { Agent } = await import("../src/agent/loop.js");
    const agent = await Agent.create();
    const seenTypes: string[] = [];

    agent.onEvent((event) => {
      seenTypes.push(event.type);
    });

    await agent.runLoop("hello");
    expect(seenTypes).toEqual([
      "agent_start",
      "turn_start",
      "message_start",
      "message_delta",
      "message_delta",
      "message_end",
      "turn_end",
      "agent_end",
    ]);
  });
});
