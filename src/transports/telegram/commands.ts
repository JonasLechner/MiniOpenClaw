import { createNewSession } from "../../core/sessions.js";
import { bindTelegramConversationToSession, type ConversationBinding } from "../../core/conversation-bindings.js";
import type { RuntimeState } from "../../core/runtime.js";
import type { TelegramMessageStreamer } from "./message-streamer.js";

export type TelegramCommandContext = {
  runtime: RuntimeState;
  binding: ConversationBinding;
  streamer: TelegramMessageStreamer;
  stopActiveRun?: () => boolean;
};

export type TelegramCommandResult =
  | { handled: false }
  | { handled: true; sessionId?: string };

export async function handleTelegramCommand(
  text: string,
  context: TelegramCommandContext,
): Promise<TelegramCommandResult> {
  if (!text.startsWith("/")) return { handled: false };

  const [rawCommand] = text.trim().split(/\s+/);
  const command = rawCommand?.split("@")[0];

  if (command === "/help" || command === "/start") {
    await context.streamer.sendText(
      context.binding.chatId,
      [
        "Commands:",
        "/help - show this help",
        "/new - start a new session",
        "/session - show the current session id",
        "/stop - abort the current run",
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

  if (command === "/stop") {
    const stopped = context.stopActiveRun?.() ?? false;
    await context.streamer.sendText(
      context.binding.chatId,
      stopped ? "Stopping current run…" : "No active run to stop.",
    );
    return { handled: true };
  }

  return { handled: false };
}
