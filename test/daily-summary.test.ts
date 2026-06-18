import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, vi } from "vitest";
import {
  createDailySummary,
  dailySummaryExists,
  getPreviousLocalDayDate,
  shouldEnsurePreviousDailySummary,
} from "../src/jobs/daily-summary.js";
import type { RuntimePaths } from "../src/core/config.js";
import type { RuntimeState } from "../src/core/runtime.js";
import { createNewSession, appendUserMessageEvent, appendAssistantMessageEvent } from "../src/core/sessions.js";

const { completeSimpleMock, resolveAgentAuthMock } = vi.hoisted(() => ({
  completeSimpleMock: vi.fn(),
  resolveAgentAuthMock: vi.fn(),
}));

vi.mock("@earendil-works/pi-ai", () => ({
  completeSimple: completeSimpleMock,
}));

vi.mock("../src/agent/auth.js", () => ({
  resolveAgentAuth: resolveAgentAuthMock,
}));

function createRuntimePaths(root: string): RuntimePaths {
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

function createRuntime(paths: RuntimePaths): RuntimeState {
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
      logging: { level: "info" },
    },
    paths,
  };
}

test("shouldEnsurePreviousDailySummary ensures yesterday exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "miniopenclaw-daily-summary-check-"));

  try {
    const paths = createRuntimePaths(root);
    const runtime = createRuntime(paths);
    const now = new Date("2026-06-04T08:00:00");
    const yesterday = getPreviousLocalDayDate(now);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T12:00:00"));
    const session = await createNewSession(paths);
    await appendUserMessageEvent(session, "yesterday activity");
    vi.useRealTimers();

    assert.equal(await shouldEnsurePreviousDailySummary(runtime, now), true);
    await mkdir(paths.memory, { recursive: true });
    await writeFile(join(paths.memory, "2026-06-03.md"), "", "utf8");
    assert.equal(await dailySummaryExists(runtime, yesterday), false);

    await writeFile(join(paths.memory, "2026-06-03.md"), "# Daily summary 2026-06-03\n", "utf8");
    assert.equal(await dailySummaryExists(runtime, yesterday), true);
    assert.equal(await shouldEnsurePreviousDailySummary(runtime, now), false);
    assert.equal(await shouldEnsurePreviousDailySummary(runtime, now, "2026-06-03"), false);
  } finally {
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  }
});

test("shouldEnsurePreviousDailySummary skips days with no session activity", async () => {
  const root = await mkdtemp(join(tmpdir(), "miniopenclaw-daily-summary-empty-"));

  try {
    const paths = createRuntimePaths(root);
    const runtime = createRuntime(paths);
    const now = new Date("2026-06-04T08:00:00");

    assert.equal(await shouldEnsurePreviousDailySummary(runtime, now), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("createDailySummary writes one llm-generated markdown file under workspace/memory", async () => {
  const root = await mkdtemp(join(tmpdir(), "miniopenclaw-daily-summary-"));

  try {
    const paths = createRuntimePaths(root);
    const runtime = createRuntime(paths);
    const session = await createNewSession(paths);
    await appendUserMessageEvent(session, "hello");
    await appendAssistantMessageEvent(session, {
      role: "assistant",
      content: [{ type: "text", text: "world" }],
      api: "openai-responses",
      provider: "openai",
      model: "gpt-test",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });

    resolveAgentAuthMock.mockResolvedValue({ model: { provider: "openai", id: "gpt-test" }, apiKey: "test-key" });
    completeSimpleMock.mockResolvedValue({ content: [{ type: "text", text: "# Daily summary\n\nShort LLM summary." }] });

    const now = new Date();
    const localDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const outputPath = await createDailySummary(runtime, now);
    const content = await readFile(outputPath, "utf8");

    assert.equal(outputPath, join(paths.memory, `${localDay}.md`));
    assert.equal(content, `# Daily summary ${localDay}\n\nSessions included: ${session.sessionId}\n\nShort LLM summary.\n`);
    assert.equal(completeSimpleMock.mock.calls.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
    vi.clearAllMocks();
  }
});
