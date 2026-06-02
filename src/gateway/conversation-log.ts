const ansi = {
  dim: "\u001b[2m",
  reset: "\u001b[0m",
  blue: "\u001b[34m",
  cyan: "\u001b[36m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  magenta: "\u001b[35m",
  red: "\u001b[31m",
  gray: "\u001b[90m",
} as const;

export type ConversationLogSource = "telegram" | "telegram-detached" | "scheduled-main-session" | "scheduled-detached";

export type ConversationLogEntry = {
  event: "conversation_message";
  timestamp: string;
  role: "user" | "assistant";
  source: ConversationLogSource;
  chatId: string;
  userId?: string;
  taskId?: string;
  stopReason?: string;
  text: string;
};

export type ConversationToolCallLogEntry = {
  event: "conversation_tool_call";
  timestamp: string;
  phase: "start" | "end";
  source: ConversationLogSource;
  chatId: string;
  userId?: string;
  taskId?: string;
  toolCallId: string;
  toolName: string;
  args?: unknown;
  durationMs?: number;
  isError?: boolean;
};

function color(text: string, value: string): string {
  return `${value}${text}${ansi.reset}`;
}

function formatTimestamp(timestamp: string): string {
  return color(new Date(timestamp).toISOString().slice(11, 23), ansi.dim);
}

function formatSource(source: ConversationLogSource): string {
  const sourceColor = source === "telegram"
    ? ansi.blue
    : source === "scheduled-main-session"
      ? ansi.magenta
      : ansi.yellow;
  return color(source, sourceColor);
}

function formatRole(role: ConversationLogEntry["role"]): string {
  return color(role, role === "user" ? ansi.cyan : ansi.green);
}

function formatMeta(meta: Record<string, string | undefined>): string {
  const parts = Object.entries(meta)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${color(key, ansi.gray)}=${value}`);
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function writeLogLine(pretty: string, json: unknown): void {
  if (process.stdout.isTTY) {
    console.log(pretty);
    return;
  }

  console.log(JSON.stringify(json));
}

export function logConversationMessage(entry: Omit<ConversationLogEntry, "event" | "timestamp">): void {
  const payload = {
    event: "conversation_message",
    timestamp: new Date().toISOString(),
    ...entry,
  } satisfies ConversationLogEntry;

  const pretty = [
    [
      formatTimestamp(payload.timestamp),
      color("msg", ansi.gray),
      formatSource(payload.source),
      formatRole(payload.role),
      formatMeta({
        chat: payload.chatId,
        user: payload.userId,
        task: payload.taskId,
        stop: payload.stopReason,
      }),
    ].join(" "),
    payload.text,
  ].join("\n");

  writeLogLine(pretty, payload);
}

export function logConversationToolCall(entry: Omit<ConversationToolCallLogEntry, "event" | "timestamp">): void {
  const payload = {
    event: "conversation_tool_call",
    timestamp: new Date().toISOString(),
    ...entry,
  } satisfies ConversationToolCallLogEntry;

  const phaseColor = payload.phase === "start" ? ansi.yellow : payload.isError ? ansi.red : ansi.green;
  const args = payload.phase === "start" && payload.args !== undefined
    ? ` ${color("args", ansi.gray)}=${JSON.stringify(payload.args)}`
    : "";
  const duration = payload.durationMs === undefined ? "" : ` ${color("durationMs", ansi.gray)}=${payload.durationMs}`;
  const status = payload.phase === "end" ? ` ${color("error", ansi.gray)}=${String(Boolean(payload.isError))}` : "";

  const pretty = [
    formatTimestamp(payload.timestamp),
    color("tool", ansi.gray),
    formatSource(payload.source),
    color(payload.phase, phaseColor),
    color(payload.toolName, ansi.yellow),
    formatMeta({
      chat: payload.chatId,
      user: payload.userId,
      task: payload.taskId,
      call: payload.toolCallId,
    }),
  ].join(" ") + args + duration + status;

  writeLogLine(pretty, payload);
}
