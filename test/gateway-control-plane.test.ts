import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RuntimePaths } from "../src/core/config.js";
import {
  bindTelegramConversationToSession,
  getTelegramConversationBindingByChatId,
  resolveTelegramConversationBinding,
} from "../src/core/conversation-bindings.js";
import {
  createScheduledTask,
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

    const binding = await resolveTelegramConversationBinding(paths, "chat-1", "user-1");
    expect(binding.sessionId).toBeTypeOf("string");

    const updated = await bindTelegramConversationToSession(paths, "chat-1", "user-1", "session-2");
    expect(updated.sessionId).toBe("session-2");

    const reloaded = await resolveTelegramConversationBinding(paths, "chat-1", "user-1");
    expect(reloaded.sessionId).toBe("session-2");
    expect((await getTelegramConversationBindingByChatId(paths, "chat-1")).sessionId).toBe("session-2");
  });

  it("keeps bindings from concurrent writes for different chats", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);

    await Promise.all([
      bindTelegramConversationToSession(paths, "chat-1", "user-1", "session-1"),
      bindTelegramConversationToSession(paths, "chat-2", "user-2", "session-2"),
    ]);

    expect((await getTelegramConversationBindingByChatId(paths, "chat-1")).sessionId).toBe("session-1");
    expect((await getTelegramConversationBindingByChatId(paths, "chat-2")).sessionId).toBe("session-2");
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
