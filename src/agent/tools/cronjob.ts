import { Type } from "@earendil-works/pi-ai";
import { initializeRuntime } from "../../core/runtime.js";
import {
  createScheduledTask,
  listScheduledTasks,
  setScheduledTaskEnabled,
  validateCronExpression,
} from "../../jobs/task-store.js";
import { textToolResult, type ToolDefinition, type ToolRunResult } from "./types.js";

export type CronjobInput =
  | { action: "list" }
  | {
      action: "create";
      chatId: string;
      cron: string;
      prompt: string;
      target?: "main-session" | "detached";
      kind?: "prompt" | "notification";
      enabled?: boolean;
    }
  | { action: "enable"; id: string }
  | { action: "disable"; id: string };

function formatResult(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export const cronjobTool: ToolDefinition<CronjobInput, ToolRunResult> = {
  name: "cronjob",
  description: "Manage scheduled Telegram cron jobs stored in the runtime scheduled-tasks.json file. Supports listing, creating, enabling, and disabling jobs. Does not execute jobs immediately.",
  parameters: Type.Object({
    action: Type.String({ enum: ["list", "create", "enable", "disable"] }),
    id: Type.Optional(Type.String()),
    chatId: Type.Optional(Type.String()),
    cron: Type.Optional(Type.String()),
    prompt: Type.Optional(Type.String()),
    target: Type.Optional(Type.String({ enum: ["main-session", "detached"] })),
    kind: Type.Optional(Type.String({ enum: ["prompt", "notification"] })),
    enabled: Type.Optional(Type.Boolean()),
  }),
  async run(input) {
    const runtime = initializeRuntime();

    switch (input.action) {
      case "list":
        return textToolResult(formatResult(await listScheduledTasks(runtime.paths)));

      case "create": {
        if (!input.chatId) throw new Error("chatId is required for create");
        if (!input.cron) throw new Error("cron is required for create");
        if (!input.prompt) throw new Error("prompt is required for create");
        validateCronExpression(input.cron);

        const created = await createScheduledTask(runtime.paths, {
          channel: "telegram",
          chatId: input.chatId,
          target: input.target ?? "main-session",
          kind: input.kind ?? "prompt",
          prompt: input.prompt,
          cron: input.cron,
          enabled: input.enabled ?? true,
        });
        return textToolResult(formatResult(created));
      }

      case "enable":
        if (!input.id) throw new Error("id is required for enable");
        return textToolResult(formatResult(await setScheduledTaskEnabled(runtime.paths, input.id, true)));

      case "disable":
        if (!input.id) throw new Error("id is required for disable");
        return textToolResult(formatResult(await setScheduledTaskEnabled(runtime.paths, input.id, false)));
    }
  },
};
