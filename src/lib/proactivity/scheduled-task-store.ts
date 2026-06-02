import { randomUUID } from "node:crypto";
import type { RuntimePaths } from "../config.js";
import { readJsonFile, writeJsonFile } from "../json-store.js";
import type { ScheduledTask } from "./scheduled-task-types.js";

async function loadTasks(paths: RuntimePaths): Promise<ScheduledTask[]> {
  return readJsonFile(paths.scheduledTasks, [] as ScheduledTask[]);
}

async function saveTasks(paths: RuntimePaths, tasks: ScheduledTask[]): Promise<void> {
  await writeJsonFile(paths.scheduledTasks, tasks);
}

function parseCronField(field: string, min: number, max: number, value: number): boolean {
  if (field === "*") return true;

  for (const part of field.split(",")) {
    if (part.includes("/")) {
      const [base, stepText] = part.split("/");
      const step = Number(stepText);
      if (!Number.isInteger(step) || step <= 0) {
        throw new Error(`Invalid cron step: ${part}`);
      }

      if (base === "*") {
        if ((value - min) % step === 0) return true;
        continue;
      }

      const [rangeStartText, rangeEndText] = base.split("-");
      const rangeStart = Number(rangeStartText);
      const rangeEnd = Number(rangeEndText);
      if (!Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd)) {
        throw new Error(`Invalid cron range: ${part}`);
      }
      if (value >= rangeStart && value <= rangeEnd && (value - rangeStart) % step === 0) return true;
      continue;
    }

    if (part.includes("-")) {
      const [startText, endText] = part.split("-");
      const start = Number(startText);
      const end = Number(endText);
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw new Error(`Invalid cron range: ${part}`);
      }
      if (value >= start && value <= end) return true;
      continue;
    }

    const exact = Number(part);
    if (!Number.isInteger(exact)) {
      throw new Error(`Invalid cron value: ${part}`);
    }
    if (value === exact) return true;
  }

  if (value < min || value > max) {
    throw new Error(`Cron value ${value} outside allowed range ${min}-${max}.`);
  }

  return false;
}

export function matchesCronExpression(cron: string, date: Date): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression "${cron}": expected 5 fields.`);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return parseCronField(minute, 0, 59, date.getMinutes())
    && parseCronField(hour, 0, 23, date.getHours())
    && parseCronField(dayOfMonth, 1, 31, date.getDate())
    && parseCronField(month, 1, 12, date.getMonth() + 1)
    && parseCronField(dayOfWeek, 0, 6, date.getDay());
}

function toMinuteKey(date: Date): string {
  return date.toISOString().slice(0, 16);
}

export async function createScheduledTask(
  paths: RuntimePaths,
  task: Omit<ScheduledTask, "id" | "createdAt" | "updatedAt" | "lastRunAt">,
): Promise<ScheduledTask> {
  const tasks = await loadTasks(paths);
  const now = new Date().toISOString();
  const created: ScheduledTask = {
    ...task,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  };

  tasks.push(created);
  await saveTasks(paths, tasks);
  return created;
}

export async function listScheduledTasks(paths: RuntimePaths): Promise<ScheduledTask[]> {
  return loadTasks(paths);
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
  const tasks = await loadTasks(paths);
  const task = tasks.find((entry) => entry.id === taskId);
  if (!task) {
    throw new Error(`Unknown scheduled task ${taskId}.`);
  }

  task.lastRunAt = now.toISOString();
  task.updatedAt = now.toISOString();
  await saveTasks(paths, tasks);
}
