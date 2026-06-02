export type LogLevel = "debug" | "info" | "warn" | "error";

type LogRecordValue = unknown;
export type LogFields = Record<string, LogRecordValue>;

type LoggerMethod = (event: string, fields?: LogFields) => void;

const ansi = {
  dim: "\u001b[2m",
  reset: "\u001b[0m",
  blue: "\u001b[34m",
  cyan: "\u001b[36m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  gray: "\u001b[90m",
} as const;

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let configuredLevel: LogLevel = "info";

export type Logger = {
  child(fields: LogFields): Logger;
  debug: LoggerMethod;
  info: LoggerMethod;
  warn: LoggerMethod;
  error: LoggerMethod;
};

export function configureLogging(level: LogLevel | undefined): void {
  configuredLevel = level ?? "info";
}

export function getConfiguredLogLevel(): LogLevel {
  return configuredLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[configuredLevel];
}

function color(text: string, value: string): string {
  return `${value}${text}${ansi.reset}`;
}

function formatTimestamp(timestamp: string): string {
  return color(new Date(timestamp).toISOString().slice(11, 23), ansi.dim);
}

function normalizeValue(value: LogRecordValue): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  return value;
}

function pruneUndefined(fields: LogFields): Record<string, unknown> {
  const entries = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, normalizeValue(value)]);
  return Object.fromEntries(entries);
}

function pickPrettyMeta(fields: Record<string, unknown>): Array<[string, unknown]> {
  const preferredKeys = [
    "sessionId",
    "runId",
    "taskId",
    "chatId",
    "userId",
    "method",
    "url",
    "statusCode",
    "durationMs",
    "engine",
    "image",
    "address",
    "source",
    "toolName",
    "toolCallId",
    "trigger",
    "message",
  ];

  const ordered: Array<[string, unknown]> = [];
  const seen = new Set<string>();

  for (const key of preferredKeys) {
    if (!(key in fields)) continue;
    if (fields[key] === undefined) continue;
    ordered.push([key, fields[key]]);
    seen.add(key);
  }

  for (const entry of Object.entries(fields)) {
    if (seen.has(entry[0])) continue;
    if (entry[1] === undefined) continue;
    ordered.push(entry);
  }

  return ordered;
}

function formatIndentedBlock(text: string, colorCode: string): string {
  return text
    .split("\n")
    .map((line) => `${color("▌", ansi.gray)} ${color(line, colorCode)}`)
    .join("\n");
}

function extractPrettyBody(event: string, fields: Record<string, unknown>): { text?: string; colorCode: string } | undefined {
  if (event === "conversation_message" && typeof fields.text === "string") {
    return {
      text: fields.text,
      colorCode: fields.role === "assistant" ? ansi.green : fields.role === "user" ? ansi.cyan : ansi.dim,
    };
  }

  if (event === "conversation_tool_call" && fields.phase === "start" && fields.args && typeof fields.args === "object") {
    const args = fields.args as { command?: unknown };
    if (typeof args.command === "string") {
      return {
        text: args.command,
        colorCode: ansi.yellow,
      };
    }

    return {
      text: JSON.stringify(fields.args, null, 2),
      colorCode: ansi.yellow,
    };
  }

  return undefined;
}

function formatPrettyLine(level: LogLevel, event: string, timestamp: string, fields: Record<string, unknown>): string {
  const levelColor = level === "error" ? ansi.red : level === "warn" ? ansi.yellow : level === "debug" ? ansi.gray : ansi.green;
  const body = extractPrettyBody(event, fields);
  const meta = pickPrettyMeta(body === undefined ? fields : { ...fields, text: undefined, args: undefined })
    .map(([key, value]) => `${color(key, ansi.gray)}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" ");

  const header = [
    formatTimestamp(timestamp),
    color(level, levelColor),
    color(event, ansi.blue),
    meta,
  ].filter(Boolean).join(" ");

  if (body === undefined || body.text === undefined) {
    return header;
  }

  return `${header}\n${formatIndentedBlock(body.text, body.colorCode)}`;
}

function emit(level: LogLevel, event: string, fields: LogFields): void {
  if (!shouldLog(level)) return;

  const timestamp = new Date().toISOString();
  const payload = {
    timestamp,
    level,
    event,
    ...pruneUndefined(fields),
  };

  if (process.stdout.isTTY) {
    console.log(formatPrettyLine(level, event, timestamp, pruneUndefined(fields)));
    return;
  }

  console.log(JSON.stringify(payload));
}

export function createLogger(baseFields: LogFields = {}): Logger {
  const logWithLevel = (level: LogLevel): LoggerMethod => {
    return (event, fields = {}) => {
      emit(level, event, { ...baseFields, ...fields });
    };
  };

  return {
    child(fields) {
      return createLogger({ ...baseFields, ...fields });
    },
    debug: logWithLevel("debug"),
    info: logWithLevel("info"),
    warn: logWithLevel("warn"),
    error: logWithLevel("error"),
  };
}
