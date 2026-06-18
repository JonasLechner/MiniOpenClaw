import { randomUUID } from "node:crypto";
import type { RuntimePaths } from "../core/config.js";
import { readJsonFile, updateJsonFile } from "../core/json-store.js";
import type { ScheduledTask } from "./types.js";

export const DEFAULT_REFLECTION_CRON = "0 1 * * *";
export const DEFAULT_REFLECTION_PROMPT = [
  "Review yesterday's daily summaries in workspace/memory.",
  "Look for durable user preferences, recurring constraints, corrections, project conventions, mistakes worth learning from, reusable workflows, and opportunities to create or improve workspace skills.",
  "Summarize only genuinely useful findings.",
  "If nothing interesting or durable stands out, say so briefly and do nothing else.",
  "If you find something worth preserving, send a short summary and ask whether it should be saved to user.md, context.md, or a workspace skill.",
  "Do not save anything automatically; ask first.",
].join(" ");

async function loadTasks(paths: RuntimePaths): Promise<ScheduledTask[]> {
  return readJsonFile(paths.scheduledTasks, [] as ScheduledTask[]);
}

function assertCronValueInRange(value: number, min: number, max: number, part: string): void {
  if (value < min || value > max) {
    throw new Error(`Invalid cron value ${part}: expected ${min}-${max}.`);
  }
}

function parseCronField(field: string, min: number, max: number, value: number): boolean {
  if (field === "*") return true;
  if (field === "") throw new Error("Invalid cron value: empty field");

  for (const part of field.split(",")) {
    if (part === "") throw new Error(`Invalid cron value: ${field}`);

    if (part.includes("/")) {
      const [base, stepText, extra] = part.split("/");
      if (extra !== undefined || base === undefined || stepText === undefined || base === "" || stepText === "") {
        throw new Error(`Invalid cron step: ${part}`);
      }

      const step = Number(stepText);
      if (!Number.isInteger(step) || step <= 0) {
        throw new Error(`Invalid cron step: ${part}`);
      }

      if (base === "*") {
        if ((value - min) % step === 0) return true;
        continue;
      }

      const [rangeStartText, rangeEndText, rangeExtra] = base.split("-");
      const rangeStart = Number(rangeStartText);
      const rangeEnd = Number(rangeEndText);
      if (rangeExtra !== undefined || !Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd)) {
        throw new Error(`Invalid cron range: ${part}`);
      }
      assertCronValueInRange(rangeStart, min, max, part);
      assertCronValueInRange(rangeEnd, min, max, part);
      if (rangeStart > rangeEnd) throw new Error(`Invalid cron range: ${part}`);
      if (value >= rangeStart && value <= rangeEnd && (value - rangeStart) % step === 0) return true;
      continue;
    }

    if (part.includes("-")) {
      const [startText, endText, extra] = part.split("-");
      const start = Number(startText);
      const end = Number(endText);
      if (extra !== undefined || !Number.isInteger(start) || !Number.isInteger(end)) {
        throw new Error(`Invalid cron range: ${part}`);
      }
      assertCronValueInRange(start, min, max, part);
      assertCronValueInRange(end, min, max, part);
      if (start > end) throw new Error(`Invalid cron range: ${part}`);
      if (value >= start && value <= end) return true;
      continue;
    }

    const exact = Number(part);
    if (!Number.isInteger(exact)) {
      throw new Error(`Invalid cron value: ${part}`);
    }
    assertCronValueInRange(exact, min, max, part);
    if (value === exact) return true;
  }

  return false;
}

export function matchesCronExpression(cron: string, date: Date): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression "${cron}": expected 5 fields.`);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const minuteMatches = parseCronField(minute, 0, 59, date.getMinutes());
  const hourMatches = parseCronField(hour, 0, 23, date.getHours());
  const dayOfMonthMatches = parseCronField(dayOfMonth, 1, 31, date.getDate());
  const monthMatches = parseCronField(month, 1, 12, date.getMonth() + 1);
  const dayOfWeekMatches = parseCronField(dayOfWeek, 0, 6, date.getDay());

  return minuteMatches && hourMatches && dayOfMonthMatches && monthMatches && dayOfWeekMatches;
}

export function validateCronExpression(cron: string): void {
  matchesCronExpression(cron, new Date());
}

function toMinuteKey(date: Date): string {
  return date.toISOString().slice(0, 16);
}

export async function createScheduledTask(
  paths: RuntimePaths,
  task: Omit<ScheduledTask, "id" | "createdAt" | "updatedAt" | "lastRunAt">,
): Promise<ScheduledTask> {
  validateCronExpression(task.cron);
  const now = new Date().toISOString();
  const created: ScheduledTask = {
    ...task,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  };

  await updateJsonFile(paths.scheduledTasks, [] as ScheduledTask[], async (tasks) => [...tasks, created]);
  return created;
}

export async function listScheduledTasks(paths: RuntimePaths): Promise<ScheduledTask[]> {
  return loadTasks(paths);
}

export async function createDefaultTelegramScheduledTasks(paths: RuntimePaths, chatId: string): Promise<void> {
  await updateJsonFile(paths.scheduledTasks, [] as ScheduledTask[], (tasks) => {
    const existing = tasks.find((task) => task.channel === "telegram"
      && task.chatId === chatId
      && task.cron === DEFAULT_REFLECTION_CRON
      && task.kind === "prompt"
      && task.target === "detached"
      && task.prompt === DEFAULT_REFLECTION_PROMPT);

    if (existing) return tasks;

    const now = new Date().toISOString();
    const created: ScheduledTask = {
      id: randomUUID(),
      channel: "telegram",
      chatId,
      target: "detached",
      kind: "prompt",
      prompt: DEFAULT_REFLECTION_PROMPT,
      cron: DEFAULT_REFLECTION_CRON,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };

    return [...tasks, created];
  });
}

export async function getRunnableScheduledTasks(paths: RuntimePaths, now = new Date()): Promise<ScheduledTask[]> {
  const tasks = await loadTasks(paths);
  const currentMinute = toMinuteKey(now);

  return tasks.filter((task) => {
    if (!task.enabled) return false;
    if (task.lastRunAt && toMinuteKey(new Date(task.lastRunAt)) === currentMinute) return false;
    return matchesCronExpression(task.cron, now);
  });
}

export async function markScheduledTaskRan(paths: RuntimePaths, taskId: string, now = new Date()): Promise<void> {
  await updateJsonFile(paths.scheduledTasks, [] as ScheduledTask[], async (tasks) => {
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task) {
      throw new Error(`Unknown scheduled task ${taskId}.`);
    }

    task.lastRunAt = now.toISOString();
    task.updatedAt = now.toISOString();
    return tasks;
  });
}

export type ScheduledTaskPatch = Partial<Pick<ScheduledTask, "target" | "kind" | "prompt" | "cron" | "enabled">>;

export async function updateScheduledTask(
  paths: RuntimePaths,
  taskId: string,
  patch: ScheduledTaskPatch,
): Promise<ScheduledTask> {
  if (Object.keys(patch).length === 0) {
    throw new Error("At least one scheduled task field is required for edit.");
  }
  if (patch.cron !== undefined) validateCronExpression(patch.cron);

  return updateJsonFile(paths.scheduledTasks, [] as ScheduledTask[], async (tasks) => {
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task) {
      throw new Error(`Unknown scheduled task ${taskId}.`);
    }

    Object.assign(task, patch, { updatedAt: new Date().toISOString() });
    return tasks;
  }).then((tasks) => {
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task) {
      throw new Error(`Unknown scheduled task ${taskId}.`);
    }
    return task;
  });
}

export async function deleteScheduledTask(paths: RuntimePaths, taskId: string): Promise<ScheduledTask> {
  let deleted: ScheduledTask | undefined;

  await updateJsonFile(paths.scheduledTasks, [] as ScheduledTask[], async (tasks) => {
    deleted = tasks.find((entry) => entry.id === taskId);
    if (!deleted) {
      throw new Error(`Unknown scheduled task ${taskId}.`);
    }
    return tasks.filter((entry) => entry.id !== taskId);
  });

  if (!deleted) {
    throw new Error(`Unknown scheduled task ${taskId}.`);
  }
  return deleted;
}

