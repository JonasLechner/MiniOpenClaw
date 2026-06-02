import { createNewSession } from "../../lib/sessions.js";
import { bindTelegramConversationToSession, type ConversationBinding } from "../../lib/conversation-bindings.js";
import type { RuntimeState } from "../../lib/runtime.js";
import type { TelegramMessageStreamer } from "./message-streamer.js";

export type TelegramCommandContext = {
  runtime: RuntimeState;
  binding: ConversationBinding;
  streamer: TelegramMessageStreamer;
};

export type TelegramCommandResult =
  | { handled: false }
  | { handled: true; sessionId?: string };

export async function handleTelegramCommand(
  text: string,
  context: TelegramCommandContext,
): Promise<TelegramCommandResult> {
  if (!text.startsWith("/")) return { handled: false };

  const [command] = text.trim().split(/\s+/);

  if (command === "/help" || command === "/start") {
    await context.streamer.sendText(
      context.binding.chatId,
      [
        "Commands:",
        "/help - show this help",
        "/new - start a new session",
        "/session - show the current session id",
      ].join("\n"),
    );
    return { handled: true };
  }

  if (command === "/new") {
    const session = await createNewSession(context.runtime.paths);
    const binding = await bindTelegramConversationToSession(
      context.runtime.paths,
      context.binding.chatId,
      context.binding.userId,
      session.sessionId,
    );
    await context.streamer.sendText(context.binding.chatId, `Started new session ${session.sessionId}.`);
    return { handled: true, sessionId: binding.sessionId };
  }

  if (command === "/session") {
    await context.streamer.sendText(context.binding.chatId, `Current session: ${context.binding.sessionId}`);
    return { handled: true };
  }

  return { handled: false };
}
