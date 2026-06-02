import { resolveTelegramConversationBinding } from "../../core/conversation-bindings.js";
import type { RuntimeState } from "../../core/runtime.js";
import type { MainSessionAgent } from "../../gateway/agent-runner.js";
import { logConversationMessage } from "../../gateway/conversation-log.js";
import { handleTelegramCommand, TELEGRAM_BOT_COMMANDS } from "./commands.js";
import { TelegramApiClient } from "./api.js";
import { TelegramMessageStreamer } from "./message-streamer.js";
import { createTelegramPolling, type TelegramPolling } from "./polling.js";

export type TelegramGatewayApp = {
  streamer: TelegramMessageStreamer;
  start(): Promise<void>;
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
    const commandResult = await handleTelegramCommand(text, {
      runtime,
      binding,
      streamer,
      stopActiveRun: () => mainSessionAgent.stopActiveRun(),
      getStatus: () => mainSessionAgent.getStatus(),
    });
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

    const stream = await streamer.startStream(chatId);
    try {
      const result = await mainSessionAgent.runPrompt(binding.sessionId, text, {
        source: "telegram",
        chatId,
        userId,
      }, {
        onEvent(event) {
          if (event.type === "message_delta") {
            stream.append(event.delta);
          }
        },
      });
      logConversationMessage({
        role: "assistant",
        source: "telegram",
        chatId,
        userId,
        stopReason: result.stopReason,
        text: result.text || "Done.",
      });
      await stream.finish(result.text || "Done.");
    } catch (error) {
      const message = error instanceof Error ? `Error: ${error.message}` : `Error: ${String(error)}`;
      await stream.fail(message);
    }
  }

  const polling: TelegramPolling = createTelegramPolling(api, async (update) => {
    const message = update.message;
    if (!message?.text || message.chat.type !== "private" || !message.from) return;

    if (!isAllowedUser(runtime, message.from.id)) {
      await streamer.sendText(String(message.chat.id), "Unauthorized Telegram user.");
      return;
    }

    const chatId = String(message.chat.id);
    const userId = String(message.from.id);
    const text = message.text;

    if (text.trim().split(/\s+/)[0]?.split("@")[0] === "/stop") {
      try {
        await handleTextMessage(chatId, userId, text);
      } catch (error) {
        await streamer.sendText(
          chatId,
          error instanceof Error ? `Error: ${error.message}` : `Error: ${String(error)}`,
        );
      }
      return;
    }

    await enqueue(chatId, async () => {
      try {
        await handleTextMessage(chatId, userId, text);
      } catch (error) {
        await streamer.sendText(
          chatId,
          error instanceof Error ? `Error: ${error.message}` : `Error: ${String(error)}`,
        );
      }
    });
  });

  return {
    streamer,
    async start() {
      try {
        await api.setMyCommands(TELEGRAM_BOT_COMMANDS);
        console.log("Registered Telegram bot commands:", TELEGRAM_BOT_COMMANDS.map(({ command }) => `/${command}`).join(", "));
      } catch (error) {
        console.error("Failed to register Telegram bot commands:", error instanceof Error ? error.message : String(error));
      }
      polling?.start();
    },
    async stop() {
      await polling.stop();
      await mainSessionAgent.dispose();
    },
  };
}
