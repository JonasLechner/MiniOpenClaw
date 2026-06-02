import { getTelegramConversationBindingByChatId } from "../core/conversation-bindings.js";
import type { RuntimeState } from "../core/runtime.js";
import type { ScheduledTask } from "./types.js";
import { runPromptInDetachedSession, type MainSessionAgent } from "../gateway/agent-runner.js";
import { logConversationMessage } from "../gateway/conversation-log.js";
import type { TelegramMessageStreamer } from "../transports/telegram/message-streamer.js";

function buildDetachedTaskContextMessage(task: ScheduledTask, resultText: string): string {
  return [
    `Scheduled task ${task.id} returned for prompt:`,
    task.prompt,
    "",
    resultText,
  ].join("\n");
}

export async function runScheduledTask(
  runtime: RuntimeState,
  streamer: TelegramMessageStreamer,
  task: ScheduledTask,
  mainSessionAgent: MainSessionAgent,
): Promise<void> {
  if (task.kind !== "prompt") {
    await streamer.sendText(task.chatId, task.prompt);
    return;
  }

  if (task.target === "main-session") {
    const binding = await getTelegramConversationBindingByChatId(runtime.paths, task.chatId);
    logConversationMessage({
      role: "user",
      source: "scheduled-main-session",
      chatId: task.chatId,
      taskId: task.id,
      text: task.prompt,
    });
    const result = await mainSessionAgent.runPrompt(binding.sessionId, task.prompt, {
      source: "scheduled-main-session",
      chatId: task.chatId,
      taskId: task.id,
    });
    logConversationMessage({
      role: "assistant",
      source: "scheduled-main-session",
      chatId: task.chatId,
      taskId: task.id,
      stopReason: result.stopReason,
      text: result.text || "Done.",
    });
    await streamer.sendText(task.chatId, result.text || "Done.");
    return;
  }

  const binding = await getTelegramConversationBindingByChatId(runtime.paths, task.chatId);
  logConversationMessage({
    role: "user",
    source: "scheduled-detached",
    chatId: task.chatId,
    taskId: task.id,
    text: task.prompt,
  });
  const result = await runPromptInDetachedSession(runtime, task.prompt, {
    source: "scheduled-detached",
    chatId: task.chatId,
    taskId: task.id,
  }, { sandboxSessionId: binding.sessionId });
  const resultText = result.text || "Done.";
  logConversationMessage({
    role: "assistant",
    source: "scheduled-detached",
    chatId: task.chatId,
    taskId: task.id,
    stopReason: result.stopReason,
    text: resultText,
  });
  await streamer.sendText(task.chatId, resultText);

  await mainSessionAgent.appendUserMessage(binding.sessionId, buildDetachedTaskContextMessage(task, resultText));
}
