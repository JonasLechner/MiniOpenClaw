import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RuntimePaths } from "../src/core/config.js";
import {
  bindTelegramChatToSession,
  requireTelegramBinding,
  resolveTelegramBinding,
} from "../src/core/conversation-bindings.js";
import {
  createDefaultTelegramScheduledTasks,
  createScheduledTask,
  DEFAULT_REFLECTION_CRON,
  DEFAULT_REFLECTION_PROMPT,
  getRunnableScheduledTasks,
  listScheduledTasks,
  markScheduledTaskRan,
  matchesCronExpression,
  validateCronExpression,
} from "../src/jobs/task-store.js";

function createRuntimePaths(): RuntimePaths {
  const root = mkdtempSync(join(tmpdir(), "miniopenclaw-control-plane-test-"));
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

describe("gateway control-plane helpers", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates and updates telegram conversation bindings", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);

    const binding = await resolveTelegramBinding(paths, "chat-1", "user-1");
    expect(binding.sessionId).toBeTypeOf("string");

    const [defaultTask] = await listScheduledTasks(paths);
    expect(defaultTask).toMatchObject({
      channel: "telegram",
      chatId: "chat-1",
      target: "detached",
      kind: "prompt",
      cron: DEFAULT_REFLECTION_CRON,
      prompt: DEFAULT_REFLECTION_PROMPT,
      enabled: true,
    });

    const sameChatDifferentUser = await resolveTelegramBinding(paths, "chat-1", "user-2");
    expect(sameChatDifferentUser.sessionId).toBe(binding.sessionId);
    expect(await listScheduledTasks(paths)).toHaveLength(1);

    const updated = await bindTelegramChatToSession(paths, "chat-1", "session-2", "user-1");
    expect(updated.sessionId).toBe("session-2");

    const reloaded = await resolveTelegramBinding(paths, "chat-1", "user-2");
    expect(reloaded.sessionId).toBe("session-2");
    expect((await requireTelegramBinding(paths, "chat-1")).sessionId).toBe("session-2");
    expect(await listScheduledTasks(paths)).toHaveLength(1);
  });

  it("keeps bindings from concurrent writes for different chats", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);

    await Promise.all([
      bindTelegramChatToSession(paths, "chat-1", "session-1", "user-1"),
      bindTelegramChatToSession(paths, "chat-2", "session-2", "user-2"),
    ]);

    expect((await requireTelegramBinding(paths, "chat-1")).sessionId).toBe("session-1");
    expect((await requireTelegramBinding(paths, "chat-2")).sessionId).toBe("session-2");
  });

  it("does not drop default tasks under concurrent creation", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);

    await Promise.all([
      createDefaultTelegramScheduledTasks(paths, "chat-1"),
      createDefaultTelegramScheduledTasks(paths, "chat-2"),
    ]);

    const tasks = await listScheduledTasks(paths);
    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => task.chatId).sort()).toEqual(["chat-1", "chat-2"]);
  });

  it("fails loudly on duplicate telegram chat bindings", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);

    writeFileSync(paths.conversationBindings, JSON.stringify([
      {
        channel: "telegram",
        chatId: "chat-1",
        sessionId: "session-1",
        createdAt: "now",
        updatedAt: "now",
      },
      {
        channel: "telegram",
        chatId: "chat-1",
        sessionId: "session-2",
        createdAt: "later",
        updatedAt: "later",
      },
    ], null, 2));

    await expect(requireTelegramBinding(paths, "chat-1")).rejects.toThrow("Multiple Telegram conversation bindings found for chat chat-1.");
  });

  it("matches basic cron expressions", () => {
    const date = new Date(2026, 4, 30, 12, 15, 0, 0);

    expect(matchesCronExpression("15 12 * * *", date)).toBe(true);
    expect(matchesCronExpression("*/5 * * * *", date)).toBe(true);
    expect(matchesCronExpression("0 12 * * *", date)).toBe(false);
    expect(matchesCronExpression("15 11 * * *", date)).toBe(false);
  });

  it("fails loudly on invalid cron expressions", () => {
    const date = new Date(2026, 4, 30, 12, 15, 0, 0);

    expect(() => matchesCronExpression("15 12 * *", date)).toThrow("expected 5 fields");
    expect(() => matchesCronExpression("x 12 * * *", date)).toThrow("Invalid cron value");
    expect(() => matchesCronExpression("0 99 * * *", date)).toThrow("expected 0-23");
    expect(() => validateCronExpression("*/0 * * * *")).toThrow("Invalid cron step");
  });

  it("rejects invalid cron expressions before persisting scheduled tasks", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);

    await expect(createScheduledTask(paths, {
      channel: "telegram",
      chatId: "chat-1",
      target: "main-session",
      kind: "prompt",
      prompt: "bad",
      cron: "* * *",
      enabled: true,
    })).rejects.toThrow("expected 5 fields");

    expect(await listScheduledTasks(paths)).toEqual([]);
  });

  it("does not let rejected invalid cron input poison later scheduler reads", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const now = new Date(2026, 4, 30, 12, 15, 0, 0);

    await expect(createScheduledTask(paths, {
      channel: "telegram",
      chatId: "chat-1",
      target: "main-session",
      kind: "prompt",
      prompt: "bad",
      cron: "x * * * *",
      enabled: true,
    })).rejects.toThrow("Invalid cron value");

    const task = await createScheduledTask(paths, {
      channel: "telegram",
      chatId: "chat-1",
      target: "main-session",
      kind: "prompt",
      prompt: "status check",
      cron: "15 12 * * *",
      enabled: true,
    });

    expect((await getRunnableScheduledTasks(paths, now)).map((entry) => entry.id)).toEqual([task.id]);
  });

  it("runs cron jobs at most once per minute", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const now = new Date(2026, 4, 30, 12, 15, 0, 0);

    const task = await createScheduledTask(paths, {
      channel: "telegram",
      chatId: "chat-1",
      target: "main-session",
      kind: "prompt",
      prompt: "status check",
      cron: "15 12 * * *",
      enabled: true,
    });

    expect((await getRunnableScheduledTasks(paths, now)).map((entry) => entry.id)).toEqual([task.id]);

    await markScheduledTaskRan(paths, task.id, now);
    expect(await getRunnableScheduledTasks(paths, now)).toHaveLength(0);

    const [stored] = await listScheduledTasks(paths);
    expect(stored.lastRunAt).toBe(now.toISOString());
  });
});
