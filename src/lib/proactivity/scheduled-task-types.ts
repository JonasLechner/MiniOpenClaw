export type ScheduledTaskTarget = "main-session" | "detached";

export type ScheduledTask = {
  id: string;
  channel: "telegram";
  chatId: string;
  target: ScheduledTaskTarget;
  kind: "prompt" | "notification";
  prompt: string;
  cron: string;
  enabled: boolean;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
};
