import { resolveTelegramConversationBinding } from "../../core/conversation-bindings.js";
import type { RuntimeState } from "../../core/runtime.js";
import type { MainSessionAgent } from "../../gateway/agent-runner.js";
import { logConversationMessage } from "../../gateway/conversation-log.js";
import { handleTelegramCommand } from "./commands.js";
import { TelegramApiClient } from "./api.js";
import { TelegramMessageStreamer } from "./message-streamer.js";
import { createTelegramPolling, type TelegramPolling } from "./polling.js";

export type TelegramGatewayApp = {
  streamer: TelegramMessageStreamer;
  start(): void;
  stop(): Promise<void>;
};
function createPromptQueue() {
  const queues = new Map<string, Promise<void>>();

  return async function enqueue(key: string, task: () => Promise<void>): Promise<void> {
    const previous = queues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    queues.set(key, current.finally(() => {
      if (queues.get(key) === current) {
        queues.delete(key);
      }
    }));
    await current;
  };
}

function isAllowedUser(runtime: RuntimeState, userId: number): boolean {
  const allowed = runtime.config.gateway.telegram.allowedUserIds;
  return allowed.length === 0 || allowed.includes(String(userId));
}

export function buildTelegramGatewayApp(
  runtime: RuntimeState,
  mainSessionAgent: MainSessionAgent,
): TelegramGatewayApp | undefined {
  const telegramConfig = runtime.config.gateway.telegram;
  if (!telegramConfig.enabled || !telegramConfig.token || !telegramConfig.polling) {
    return undefined;
  }

  const api = new TelegramApiClient(telegramConfig.token);
  const streamer = new TelegramMessageStreamer(api);
  const enqueue = createPromptQueue();

  async function handleTextMessage(chatId: string, userId: string, text: string): Promise<void> {
    const binding = await resolveTelegramConversationBinding(runtime.paths, chatId, userId);
    const commandResult = await handleTelegramCommand(text, { runtime, binding, streamer });
    if (commandResult.handled) {
      if (commandResult.sessionId) {
        await mainSessionAgent.bindSession(commandResult.sessionId);
      }
      return;
    }

    logConversationMessage({
      role: "user",
      source: "telegram",
      chatId,
      userId,
      text,
    });

    await streamer.sendText(chatId, "Thinking…");
    const result = await mainSessionAgent.runPrompt(binding.sessionId, text, {
      source: "telegram",
      chatId,
      userId,
    });
    logConversationMessage({
      role: "assistant",
      source: "telegram",
      chatId,
      userId,
      stopReason: result.stopReason,
      text: result.text || "Done.",
    });
    await streamer.sendText(chatId, result.text || "Done.");
  }

  const polling: TelegramPolling = createTelegramPolling(api, async (update) => {
    const message = update.message;
    if (!message?.text || message.chat.type !== "private" || !message.from) return;

    if (!isAllowedUser(runtime, message.from.id)) {
      await streamer.sendText(String(message.chat.id), "Unauthorized Telegram user.");
      return;
    }

    await enqueue(String(message.chat.id), async () => {
      try {
        await handleTextMessage(String(message.chat.id), String(message.from!.id), message.text!);
      } catch (error) {
        await streamer.sendText(
          String(message.chat.id),
          error instanceof Error ? `Error: ${error.message}` : `Error: ${String(error)}`,
        );
      }
    });
  });

  return {
    streamer,
    start() {
      polling?.start();
    },
    async stop() {
      await polling.stop();
      await mainSessionAgent.dispose();
    },
  };
}
