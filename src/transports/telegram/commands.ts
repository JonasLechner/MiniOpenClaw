import { createNewSession } from "../../core/sessions.js";
import { bindTelegramChatToSession, type ConversationBinding } from "../../core/conversation-bindings.js";
import { type BackgroundTaskLauncher } from "../../jobs/background.js";
import { formatBackgroundTaskList } from "../../jobs/background-format.js";
import type { RuntimeState } from "../../core/runtime.js";
import type { TelegramMessageStreamer } from "./message-streamer.js";

export type TelegramCommandContext = {
  runtime: RuntimeState;
  binding: ConversationBinding;
  streamer: TelegramMessageStreamer;
  stopActiveRun?: () => boolean;
  getStatus?: () => { provider: string; modelId: string; activeRunId?: string; activeRunStartedAt?: string };
  backgroundTaskLauncher?: BackgroundTaskLauncher;
  compactSession?: () => Promise<{ compacted: boolean; warning?: string; estimatedTokensBefore: number; estimatedTokensAfter?: number }>;
};

export type TelegramCommandResult =
  | { handled: false }
  | { handled: true; sessionId?: string };

export const TELEGRAM_BOT_COMMANDS = [
  { command: "new", description: "Start a new session" },
  { command: "session", description: "Show the current session id" },
  { command: "bg", description: "Run a prompt in the background" },
  { command: "bglist", description: "List background tasks for this session" },
  { command: "bgstop", description: "Stop a background task" },
  { command: "compact", description: "Compact the current session" },
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
    const binding = await bindTelegramChatToSession(
      context.runtime.paths,
      context.binding.chatId,
      session.sessionId,
      context.binding.userId,
    );
    await context.streamer.sendText(context.binding.chatId, `Started new session ${session.sessionId}.`);
    return { handled: true, sessionId: binding.sessionId };
  }

  if (command === "/session") {
    const status: { provider: string; modelId: string; activeRunId?: string; activeRunStartedAt?: string } = context.getStatus?.() ?? {
      provider: context.runtime.config.agent.provider ?? "unknown",
      modelId: context.runtime.config.agent.modelId ?? "unknown",
    };
    await context.streamer.sendText(
      context.binding.chatId,
      [
        `Current session: ${context.binding.sessionId}`,
        `Model: ${status.provider}/${status.modelId}`,
        status.activeRunId ? `Active run id: ${status.activeRunId}` : "Active run id: none",
        status.activeRunStartedAt ? `Active run since: ${status.activeRunStartedAt}` : "Active run: none",
      ].join("\n"),
    );
    return { handled: true };
  }

  if (command === "/bg") {
    const prompt = text.slice(rawCommand.length).trim();
    if (!prompt) {
      await context.streamer.sendText(context.binding.chatId, "Usage: /bg <prompt>");
      return { handled: true };
    }
    if (!context.backgroundTaskLauncher) {
      throw new Error("Background task launcher is unavailable.");
    }

    const task = await context.backgroundTaskLauncher.launchDetachedPrompt({
      chatId: context.binding.chatId,
      userId: context.binding.userId,
      parentSessionId: context.binding.sessionId,
      prompt,
    });
    await context.streamer.sendText(
      context.binding.chatId,
      `Started background task ${task.taskId}. I will send the result here and add it back into session ${context.binding.sessionId} when it finishes.`,
    );
    return { handled: true };
  }

  if (command === "/bglist") {
    if (!context.backgroundTaskLauncher) {
      throw new Error("Background task launcher is unavailable.");
    }

    const tasks = await context.backgroundTaskLauncher.listTasks({
      parentSessionId: context.binding.sessionId,
    });
    await context.streamer.sendText(context.binding.chatId, formatBackgroundTaskList(tasks));
    return { handled: true };
  }

  if (command === "/bgstop") {
    const taskId = text.slice(rawCommand.length).trim();
    if (!taskId) {
      await context.streamer.sendText(context.binding.chatId, "Usage: /bgstop <taskId>");
      return { handled: true };
    }
    if (!context.backgroundTaskLauncher) {
      throw new Error("Background task launcher is unavailable.");
    }

    const result = await context.backgroundTaskLauncher.stopTask({
      parentSessionId: context.binding.sessionId,
      taskId,
    });
    await context.streamer.sendText(context.binding.chatId, result.reason);
    return { handled: true };
  }

  if (command === "/compact") {
    if (!context.compactSession) {
      throw new Error("Session compaction is unavailable.");
    }

    await context.streamer.sendText(context.binding.chatId, "Compacting...");
    const result = await context.compactSession();
    const message = result.compacted
      ? `Compacted session ${context.binding.sessionId}: ~${result.estimatedTokensBefore} -> ~${result.estimatedTokensAfter ?? result.estimatedTokensBefore} estimated tokens.`
      : result.warning
        ? `Compaction skipped for session ${context.binding.sessionId}: ${result.warning}`
        : `No compaction needed for session ${context.binding.sessionId} (~${result.estimatedTokensBefore} estimated tokens).`;
    await context.streamer.sendText(context.binding.chatId, message);
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
