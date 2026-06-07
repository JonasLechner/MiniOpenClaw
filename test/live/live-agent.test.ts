import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Message } from "@earendil-works/pi-ai";
import { Agent } from "../../src/agent/agent.js";
import { checkAuthAvailable } from "../../src/agent/auth.js";
import { loadRuntimeConfig, type RuntimePaths } from "../../src/core/config.js";
import { ensureRuntimeFiles, type RuntimeState } from "../../src/core/runtime.js";
import { createNewSession, getSessionMessages } from "../../src/core/sessions.js";
import {
  expectToolResultsToMatchAssistantCalls,
  getToolResultMessages,
  loadOnlySession,
} from "../helpers/session-assertions.js";

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

function getAssistantToolCallNames(messages: Message[]): string[] {
  return messages.flatMap((message) => message.role === "assistant"
    ? message.content.filter((block) => block.type === "toolCall").map((block) => block.name)
    : []);
}

function createLiveRuntime(): RuntimeState {
  const sourceRuntime = loadRuntimeConfig();
  const root = mkdtempSync(join(tmpdir(), "miniopenclaw-live-test-"));
  const paths = createRuntimePaths(root);

  mkdirSync(paths.home, { recursive: true });
  if (existsSync(sourceRuntime.paths.authFile)) {
    cpSync(sourceRuntime.paths.authFile, paths.authFile, { force: true });
  }

  writeFileSync(paths.configFile, JSON.stringify({
    ...sourceRuntime.config,
    workspacePath: paths.workspace,
    sandbox: {
      ...sourceRuntime.config.sandbox,
      enabled: false,
    },
  }, null, 2));

  ensureRuntimeFiles(paths);

  return {
    config: {
      ...sourceRuntime.config,
      workspacePath: paths.workspace,
      sandbox: {
        ...sourceRuntime.config.sandbox,
        enabled: false,
      },
    },
    paths,
  };
}

const cleanupPaths: string[] = [];
let runtime: RuntimeState;

beforeAll(() => {
  runtime = createLiveRuntime();
  cleanupPaths.push(runtime.paths.home);

  if (!runtime.config.agent.provider || !runtime.config.agent.modelId) {
    throw new Error(`Set agent.provider and agent.modelId in ${runtime.paths.configFile} or ~/.mini-openclaw/config.json before running npm run test:live.`);
  }

  if (!checkAuthAvailable(runtime)) {
    throw new Error(`No configured auth found for provider "${runtime.config.agent.provider}". Run miniopenclaw auth or update ~/.mini-openclaw/auth.json before running npm run test:live.`);
  }
});

afterAll(() => {
  for (const path of cleanupPaths) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("live AI agent workflows", () => {
  it("runs a live read-tool smoke test", { timeout: 180_000 }, async () => {
    const session = await createNewSession(runtime.paths);
    const agent = await Agent.createForSession(runtime, session.sessionId);
    const relativePath = "live-e2e/read-smoke.txt";
    const absolutePath = join(runtime.paths.workspace, relativePath);
    mkdirSync(join(runtime.paths.workspace, "live-e2e"), { recursive: true });
    writeFileSync(absolutePath, "alpha\nbeta\n", "utf8");

    try {
      const result = await agent.runLoop([
        `Use the read tool on ${relativePath}.`,
        "Do not use bash, write, or edit.",
        "After reading it, reply with exactly READ_OK and nothing else.",
      ].join("\n"));

      expect(result.stopReason).toBe("stop");
      expect(result.text?.trim()).toContain("READ_OK");

      const persistedSession = await loadOnlySession(runtime.paths);
      const messages = getSessionMessages(persistedSession);
      const toolResults = getToolResultMessages(persistedSession);
      const toolCallNames = getAssistantToolCallNames(messages);

      expect(toolCallNames).toContain("read");
      expect(toolCallNames).not.toContain("bash");
      expect(toolCallNames).not.toContain("write");
      expect(toolCallNames).not.toContain("edit");
      expect(toolResults.some((message) => message.toolName === "read" && message.isError === false)).toBe(true);
      expectToolResultsToMatchAssistantCalls(messages);
    } finally {
      await agent.dispose();
    }
  });

  it("runs a live write-read smoke test with real tools and filesystem validation", { timeout: 180_000 }, async () => {
    const session = await createNewSession(runtime.paths);
    const agent = await Agent.createForSession(runtime, session.sessionId);
    const relativePath = "live-e2e/workflow.txt";
    const absolutePath = join(runtime.paths.workspace, relativePath);
    mkdirSync(join(runtime.paths.workspace, "live-e2e"), { recursive: true });

    try {
      const result = await agent.runLoop([
        `Use the write tool to create ${relativePath} with exactly this content:`,
        "alpha",
        "beta",
        "",
        `Then use the read tool on ${relativePath} to verify it.`,
        "Do not use bash or edit.",
        "After the verification, reply with exactly DONE and nothing else.",
      ].join("\n"));

      expect(result.stopReason).toBe("stop");
      expect(result.text?.trim()).toContain("DONE");
      expect(await readFile(absolutePath, "utf8")).toBe("alpha\nbeta\n");

      const persistedSession = await loadOnlySession(runtime.paths);
      const messages = getSessionMessages(persistedSession);
      const toolResults = getToolResultMessages(persistedSession);
      const toolCallNames = getAssistantToolCallNames(messages);
      const eventTypes = persistedSession.events.map((event) => event.type);

      expect(toolCallNames).toContain("write");
      expect(toolCallNames).toContain("read");
      expect(toolResults.every((message) => message.isError === false)).toBe(true);
      expect(eventTypes[0]).toBe("system");
      expect(eventTypes).toContain("user_message");
      expect(eventTypes).toContain("assistant_message");
      expect(eventTypes).toContain("tool_result_message");
      expectToolResultsToMatchAssistantCalls(messages);
    } finally {
      await agent.dispose();
    }
  });

  it("continues across live turns after real tool use", { timeout: 240_000 }, async () => {
    const session = await createNewSession(runtime.paths);
    const agent = await Agent.createForSession(runtime, session.sessionId);
    const relativePath = "live-e2e/continuation.txt";
    const absolutePath = join(runtime.paths.workspace, relativePath);
    mkdirSync(join(runtime.paths.workspace, "live-e2e"), { recursive: true });

    try {
      const firstResult = await agent.runLoop([
        `Use the write tool to create ${relativePath} with exactly this content:`,
        "alpha",
        "beta",
        "",
        "After writing it, reply with exactly FIRST_DONE and nothing else.",
      ].join("\n"));

      expect(firstResult.stopReason).toBe("stop");
      expect(firstResult.text?.trim()).toContain("FIRST_DONE");
      expect(await readFile(absolutePath, "utf8")).toBe("alpha\nbeta\n");

      const secondResult = await agent.runLoop([
        `Use the read tool on ${relativePath}.`,
        "Do not use bash, write, or edit.",
        "After reading it, reply with exactly SECOND_DONE and nothing else.",
      ].join("\n"));

      expect(secondResult.stopReason).toBe("stop");
      expect(secondResult.text?.trim()).toContain("SECOND_DONE");

      const persistedSession = await loadOnlySession(runtime.paths);
      const messages = getSessionMessages(persistedSession);
      const toolResults = getToolResultMessages(persistedSession);
      const toolCallNames = getAssistantToolCallNames(messages);

      expect(messages.filter((message) => message.role === "user")).toHaveLength(2);
      expect(toolCallNames).toContain("write");
      expect(toolCallNames).toContain("read");
      expect(toolResults.every((message) => message.isError === false)).toBe(true);
      expectToolResultsToMatchAssistantCalls(messages);
    } finally {
      await agent.dispose();
    }
  });
});
