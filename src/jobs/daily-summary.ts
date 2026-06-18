import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { completeSimple } from "@earendil-works/pi-ai";
import { resolveAgentAuth } from "../agent/auth.js";
import type { RuntimeState } from "../core/runtime.js";
import { getSessionMessages, listSessions, getSessionById } from "../core/sessions.js";

function formatLocalDay(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isSameDay(timestamp: string, day: string): boolean {
  return formatLocalDay(timestamp) === day;
}

function serializeMessage(message: ReturnType<typeof getSessionMessages>[number]): string {
  if (message.role === "user") {
    return `User: ${typeof message.content === "string" ? message.content : JSON.stringify(message.content)}`;
  }

  if (message.role === "assistant") {
    const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join(" ").trim();
    return `Assistant: ${text || "[no visible text]"}`;
  }

  return `Tool ${message.toolName}: ${message.content.map((block) => (block.type === "text" ? block.text : "")).join(" ").trim() || "[no visible text]"}`;
}

function buildDailySummaryPrompt(day: string, sessionSections: string[]): string {
  return [
    `Create one concise human-readable markdown daily summary for ${day}.`,
    "Summarize the important developments across all sessions for the day.",
    "Preserve durable signals when present: user preferences, recurring constraints, corrections, notable mistakes, learnings, reusable workflows, and possible skill-worthy patterns.",
    "Do not reproduce the full transcript. Compress repeated details.",
    "Use short markdown sections if helpful.",
    "If there was no meaningful activity, say so briefly.",
    "",
    sessionSections.join("\n\n---\n\n"),
  ].join("\n");
}

function formatSessionCoverage(sessionIds: string[]): string {
  return sessionIds.length > 0
    ? `Sessions included: ${sessionIds.join(", ")}`
    : "Sessions included: none";
}

async function summarizeDailyActivity(runtime: RuntimeState, day: string, sessionSections: string[], sessionIds: string[]): Promise<string> {
  if (sessionSections.length === 0) {
    return `# Daily summary ${day}\n\n${formatSessionCoverage(sessionIds)}\n\nNo session activity recorded today.\n`;
  }

  const auth = await resolveAgentAuth(runtime);
  const response = await completeSimple(auth.model as Parameters<typeof completeSimple>[0], {
    systemPrompt: "You write compact daily summaries across multiple assistant sessions.",
    messages: [{ role: "user", content: buildDailySummaryPrompt(day, sessionSections), timestamp: Date.now() }],
  }, {
    apiKey: auth.apiKey,
  });

  const summary = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!summary) {
    return `# Daily summary ${day}\n\n${formatSessionCoverage(sessionIds)}\n\nNo summary generated.\n`;
  }

  const body = summary.replace(/^#\s+Daily summary(?:\s+\d{4}-\d{2}-\d{2})?\s*/i, "").trim();
  return body
    ? `# Daily summary ${day}\n\n${formatSessionCoverage(sessionIds)}\n\n${body}\n`
    : `# Daily summary ${day}\n\n${formatSessionCoverage(sessionIds)}\n\nNo summary generated.\n`;
}

export function getDailySummaryPath(runtime: RuntimeState, date: Date): string {
  return join(runtime.paths.memory, `${formatLocalDay(date)}.md`);
}

export function getPreviousLocalDayDate(now = new Date()): Date {
  const previous = new Date(now);
  previous.setDate(previous.getDate() - 1);
  return previous;
}

export async function dailySummaryExists(runtime: RuntimeState, date: Date): Promise<boolean> {
  try {
    const content = await readFile(getDailySummaryPath(runtime, date), "utf8");
    return content.trim().startsWith(`# Daily summary ${formatLocalDay(date)}`);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function createDailySummary(runtime: RuntimeState, date = new Date()): Promise<string> {
  const day = formatLocalDay(date);
  const sessionSummaries = await listSessions(runtime.paths);
  const sessions = (await Promise.all(sessionSummaries.map((session) => getSessionById(runtime.paths, session.sessionId))))
    .filter((session): session is NonNullable<Awaited<ReturnType<typeof getSessionById>>> => session !== undefined);

  const sessionEntries = sessions
    .map((session) => {
      const events = session.events.filter((event) => isSameDay(event.timestamp, day));
      if (events.length === 0) return undefined;

      const messages = getSessionMessages({ events }).map(serializeMessage);
      return {
        sessionId: session.sessionId,
        section: [
          `Session ${session.sessionId}`,
          `Events today: ${events.length}`,
          messages.join("\n") || "No messages captured.",
        ].join("\n"),
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== undefined);

  const markdown = await summarizeDailyActivity(runtime, day, sessionEntries.map((entry) => entry.section), sessionEntries.map((entry) => entry.sessionId));

  await mkdir(runtime.paths.memory, { recursive: true });
  const outputPath = getDailySummaryPath(runtime, date);
  const content = markdown.endsWith("\n") ? markdown : `${markdown}\n`;
  await writeFile(outputPath, content, "utf8");

  return outputPath;
}

async function hasSessionActivityForDay(runtime: RuntimeState, day: string): Promise<boolean> {
  const sessionSummaries = await listSessions(runtime.paths);
  for (const sessionSummary of sessionSummaries) {
    const session = await getSessionById(runtime.paths, sessionSummary.sessionId);
    if (session?.events.some((event) => isSameDay(event.timestamp, day))) {
      return true;
    }
  }
  return false;
}

export async function shouldEnsurePreviousDailySummary(runtime: RuntimeState, now: Date, lastRunDate?: string): Promise<boolean> {
  const previousDate = getPreviousLocalDayDate(now);
  const previousDay = formatLocalDay(previousDate);
  if (lastRunDate === previousDay) {
    return false;
  }

  if (await dailySummaryExists(runtime, previousDate)) {
    return false;
  }

  return hasSessionActivityForDay(runtime, previousDay);
}
