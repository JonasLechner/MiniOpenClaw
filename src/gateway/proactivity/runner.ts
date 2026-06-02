import { getTelegramConversationBindingByChatId } from "../../lib/conversation-bindings.js";
import type { RuntimeState } from "../../lib/runtime.js";
import type { ScheduledTask } from "../../lib/proactivity/scheduled-task-types.js";
import { runPromptInDetachedSession, type MainSessionAgent } from "../agent-runner.js";
import type { TelegramMessageStreamer } from "../telegram/message-streamer.js";

function buildDetachedTaskContextMessage(task: ScheduledTask, resultText: string): string {
  return [
    "[SYSTEM: A detached scheduled task completed and its result was sent to the user in Telegram. Keep this in conversation context for future follow-up questions.]",
    "",
    `Task ID: ${task.id}`,
    `Task target: ${task.target}`,
    `Task kind: ${task.kind}`,
    "Result:",
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
    const result = await mainSessionAgent.runPrompt(binding.sessionId, task.prompt);
    await streamer.sendText(task.chatId, result.text || "Done.");
    return;
  }

  const result = await runPromptInDetachedSession(runtime, task.prompt);
  const resultText = result.text || "Done.";
  await streamer.sendText(task.chatId, resultText);

  const binding = await getTelegramConversationBindingByChatId(runtime.paths, task.chatId);
  await mainSessionAgent.appendUserMessage(binding.sessionId, buildDetachedTaskContextMessage(task, resultText));
}
