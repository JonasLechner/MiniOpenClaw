import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimePaths } from "../src/core/config.js";
import type { RuntimeState } from "../src/core/runtime.js";
import { createNewSession } from "../src/core/sessions.js";
import type { ConversationBinding } from "../src/core/conversation-bindings.js";
import { handleTelegramCommand } from "../src/transports/telegram/commands.js";

function createRuntimePaths(): RuntimePaths {
  const root = mkdtempSync(join(tmpdir(), "miniopenclaw-telegram-commands-test-"));
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
    },
    paths,
  };
}

describe("telegram commands", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  it("shows only the supported help commands", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);
    const runtime = createRuntime(paths);

    const binding: ConversationBinding = {
      channel: "telegram",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: "session-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const sendText = vi.fn<(chatId: string, text: string) => Promise<void>>(async () => {});
    const result = await handleTelegramCommand("/help", {
      runtime,
      binding,
      streamer: { sendText } as never,
    });

    expect(result).toEqual({ handled: true });
    expect(sendText).toHaveBeenCalledTimes(1);
    const helpText = sendText.mock.calls[0]![1];
    expect(helpText).toContain("/new - start a new session");
    expect(helpText).not.toContain("/remind");
    expect(helpText).not.toContain("/approve");
  });

  it("switches the binding to a newly created session", async () => {
    const paths = createRuntimePaths();
    roots.push(paths.home);

    const existingSession = await createNewSession(paths);
    const runtime = createRuntime(paths);

    const binding: ConversationBinding = {
      channel: "telegram",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: existingSession.sessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const sendText = vi.fn<(chatId: string, text: string) => Promise<void>>(async () => {});
    const result = await handleTelegramCommand("/new", {
      runtime,
      binding,
      streamer: { sendText } as never,
    });

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("expected command to be handled");
    expect(result).toMatchObject({ sessionId: expect.any(String) });
    expect(result.sessionId).not.toBe(existingSession.sessionId);
    expect(sendText).toHaveBeenCalledWith("chat-1", expect.stringContaining(result.sessionId!));
  });
});
