import { Type } from "@earendil-works/pi-ai";
import { formatBackgroundTaskList } from "../../jobs/background-format.js";
import { requireToolContext, textToolResult, type ToolDefinition, type ToolRunResult } from "./types.js";

export type SubagentInput =
  | { action: "start"; prompt: string }
  | { action: "list" }
  | { action: "stop"; taskId: string };

export const subagentTool: ToolDefinition<SubagentInput, ToolRunResult> = {
  name: "subagent",
  description: "Manage detached background subagents for the current Telegram-bound session. Supports start, list, and stop.",
  parameters: Type.Object({
    action: Type.String({ enum: ["start", "list", "stop"] }),
    prompt: Type.Optional(Type.String()),
    taskId: Type.Optional(Type.String()),
  }),
  async run(input, context) {
    const toolContext = requireToolContext(context);
    if (!toolContext.channel?.chatId || !toolContext.channel.sessionId) {
      throw new Error("subagent is only available from a bound chat session");
    }
    if (!toolContext.background) {
      throw new Error("subagent background launcher is unavailable in this runtime");
    }

    if (input.action === "start") {
      if (!input.prompt) throw new Error("prompt is required for subagent start");
      const task = await toolContext.background.launchDetachedPrompt({
        chatId: toolContext.channel.chatId,
        userId: toolContext.channel.userId,
        parentSessionId: toolContext.channel.sessionId,
        prompt: input.prompt,
      });

      return textToolResult(
        `Started background subagent ${task.taskId}. Its final result will be sent to Telegram and added back into this session when it completes.`,
      );
    }

    if (input.action === "list") {
      const tasks = await toolContext.background.listTasks({ parentSessionId: toolContext.channel.sessionId });
      return textToolResult(formatBackgroundTaskList(tasks));
    }

    if (!input.taskId) throw new Error("taskId is required for subagent stop");
    const result = await toolContext.background.stopTask({
      parentSessionId: toolContext.channel.sessionId,
      taskId: input.taskId,
    });
    return textToolResult(result.reason);
  },
};
