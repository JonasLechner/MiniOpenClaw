import { createLogger } from "../core/log.js";

export type ConversationLogSource = "telegram" | "telegram-detached" | "scheduled-main-session" | "scheduled-detached";

export type ConversationLogEntry = {
  event: "conversation_message";
  timestamp: string;
  role: "user" | "assistant";
  source: ConversationLogSource;
  chatId: string;
  userId?: string;
  sessionId?: string;
  runId?: string;
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
  sessionId?: string;
  runId?: string;
  taskId?: string;
  toolCallId: string;
  toolName: string;
  args?: unknown;
  durationMs?: number;
  isError?: boolean;
};

const conversationLogger = createLogger({ component: "conversation" });

export function logConversationMessage(entry: Omit<ConversationLogEntry, "event" | "timestamp">): void {
  const level = entry.role === "assistant" && entry.stopReason === "error" ? conversationLogger.error : conversationLogger.info;
  level("conversation_message", {
    role: entry.role,
    source: entry.source,
    chatId: entry.chatId,
    userId: entry.userId,
    sessionId: entry.sessionId,
    runId: entry.runId,
    taskId: entry.taskId,
    stopReason: entry.stopReason,
    text: entry.text,
  });
}

export function logConversationToolCall(entry: Omit<ConversationToolCallLogEntry, "event" | "timestamp">): void {
  const level = entry.phase === "end" && entry.isError ? conversationLogger.error : conversationLogger.info;
  level("conversation_tool_call", {
    phase: entry.phase,
    source: entry.source,
    chatId: entry.chatId,
    userId: entry.userId,
    sessionId: entry.sessionId,
    runId: entry.runId,
    taskId: entry.taskId,
    toolCallId: entry.toolCallId,
    toolName: entry.toolName,
    args: entry.args,
    durationMs: entry.durationMs,
    isError: entry.isError,
  });
}
