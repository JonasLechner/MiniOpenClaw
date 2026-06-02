import { randomUUID } from "node:crypto";
import type { RuntimePaths } from "../core/config.js";
import { readJsonFile, writeJsonFile } from "../core/json-store.js";
import type { ScheduledTask } from "./types.js";

async function loadTasks(paths: RuntimePaths): Promise<ScheduledTask[]> {
  return readJsonFile(paths.scheduledTasks, [] as ScheduledTask[]);
}

async function saveTasks(paths: RuntimePaths, tasks: ScheduledTask[]): Promise<void> {
  await writeJsonFile(paths.scheduledTasks, tasks);
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

export async function setScheduledTaskEnabled(
  paths: RuntimePaths,
  taskId: string,
  enabled: boolean,
): Promise<ScheduledTask> {
  const tasks = await loadTasks(paths);
  const task = tasks.find((entry) => entry.id === taskId);
  if (!task) {
    throw new Error(`Unknown scheduled task ${taskId}.`);
  }

  task.enabled = enabled;
  task.updatedAt = new Date().toISOString();
  await saveTasks(paths, tasks);
  return task;
}
