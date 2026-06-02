import { createNewSession } from "../../core/sessions.js";
import { bindTelegramConversationToSession, type ConversationBinding } from "../../core/conversation-bindings.js";
import type { RuntimeState } from "../../core/runtime.js";
import type { TelegramMessageStreamer } from "./message-streamer.js";

export type TelegramCommandContext = {
  runtime: RuntimeState;
  binding: ConversationBinding;
  streamer: TelegramMessageStreamer;
  stopActiveRun?: () => boolean;
  getStatus?: () => { provider: string; modelId: string; activeRunStartedAt?: string };
};

export type TelegramCommandResult =
  | { handled: false }
  | { handled: true; sessionId?: string };

export const TELEGRAM_BOT_COMMANDS = [
  { command: "new", description: "Start a new session" },
  { command: "session", description: "Show the current session id" },
  { command: "stop", description: "Abort the current run" },
] as const;

function formatHelpText(): string {
  return [
    "Commands:",
    ...TELEGRAM_BOT_COMMANDS.map(({ command, description }) => `/${command} - ${description.charAt(0).toLowerCase()}${description.slice(1)}`),
  ].join("\n");
}

export async function handleTelegramCommand(
  text: string,
  context: TelegramCommandContext,
): Promise<TelegramCommandResult> {
  if (!text.startsWith("/")) return { handled: false };

  const [rawCommand] = text.trim().split(/\s+/);
  const command = rawCommand?.split("@")[0];

  if (command === "/start") {
    await context.streamer.sendText(context.binding.chatId, formatHelpText());
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
    const status: { provider: string; modelId: string; activeRunStartedAt?: string } = context.getStatus?.() ?? {
      provider: context.runtime.config.agent.provider ?? "unknown",
      modelId: context.runtime.config.agent.modelId ?? "unknown",
    };
    await context.streamer.sendText(
      context.binding.chatId,
      [
        `Current session: ${context.binding.sessionId}`,
        `Model: ${status.provider}/${status.modelId}`,
        status.activeRunStartedAt ? `Active run since: ${status.activeRunStartedAt}` : "Active run: none",
      ].join("\n"),
    );
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
