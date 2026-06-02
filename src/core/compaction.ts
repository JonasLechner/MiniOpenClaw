import { completeSimple, type AssistantMessage, type Message, type ToolResultMessage, type UserMessage } from "@earendil-works/pi-ai";
import {
  appendSessionCompactionEvent,
  createSyntheticSummaryMessage,
  getLatestSessionCompactionEvent,
  getSessionMessages,
  type Session,
  type SessionCompactionEvent,
} from "./sessions.js";

export const DEFAULT_RESERVE_TOKENS = 16_384;
export const DEFAULT_KEEP_RECENT_TOKENS = 20_000;
const SUMMARY_TOOL_RESULT_CHAR_LIMIT = 4_000;

type CompactTrigger = SessionCompactionEvent["trigger"];

type BoundarySelection = {
  firstKeptEventIndex: number;
  firstKeptMessage?: UserMessage | AssistantMessage;
  keptTokens: number;
  replacedMessages: Message[];
};

export type CompactionResult = {
  compacted: boolean;
  event?: SessionCompactionEvent;
  warning?: string;
  estimatedTokensBefore: number;
  estimatedTokensAfter?: number;
};

function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimateAssistantMessageTokens(message: AssistantMessage): number {
  return message.content.reduce((total, block) => {
    if (block.type === "text") return total + estimateTextTokens(block.text);
    if (block.type === "thinking") return total + estimateTextTokens(block.thinking);
    if (block.type === "toolCall") {
      return total + estimateTextTokens(`${block.name} ${JSON.stringify(block.arguments ?? {})}`);
    }
    return total + estimateTextTokens(JSON.stringify(block));
  }, 0);
}

function estimateToolResultMessageTokens(message: ToolResultMessage): number {
  return message.content.reduce((total, block) => {
    if (block.type === "text") return total + estimateTextTokens(block.text);
    return total + estimateTextTokens(JSON.stringify(block));
  }, estimateTextTokens(`${message.toolName} ${message.toolCallId}`));
}

function estimateUserMessageTokens(message: UserMessage): number {
  if (typeof message.content === "string") return estimateTextTokens(message.content);
  return message.content.reduce((total, block) => {
    if (block.type === "text") return total + estimateTextTokens(block.text);
    return total + estimateTextTokens(JSON.stringify(block));
  }, 0);
}

export function estimateMessageTokens(message: Message): number {
  if (message.role === "user") return estimateUserMessageTokens(message);
  if (message.role === "assistant") return estimateAssistantMessageTokens(message);
  return estimateToolResultMessageTokens(message);
}

export function estimateSessionContextTokens(session: Session): number {
  const messages = getSessionMessages(session);

  if (getLatestSessionCompactionEvent(session)) {
    return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;

    const baseline = message.usage?.totalTokens ?? ((message.usage?.input ?? 0) + (message.usage?.output ?? 0));
    if (!baseline) continue;

    const trailing = messages.slice(index + 1).reduce((total, trailingMessage) => total + estimateMessageTokens(trailingMessage), 0);
    return baseline + trailing;
  }

  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

function truncateForSummary(text: string, limit = SUMMARY_TOOL_RESULT_CHAR_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]`;
}

function serializeMessage(message: Message): string {
  if (message.role === "user") {
    const text = typeof message.content === "string"
      ? message.content
      : message.content.map((block) => block.type === "text" ? block.text : JSON.stringify(block)).join("\n");
    return `USER\n${text}`;
  }
  if (message.role === "toolResult") {
    const text = message.content
      .map((block) => block.type === "text" ? block.text : JSON.stringify(block))
      .join("\n");
    return `TOOL RESULT ${message.toolName} (${message.toolCallId})${message.isError ? " [error]" : ""}\n${truncateForSummary(text)}`;
  }

  const parts = message.content.map((block) => {
    if (block.type === "text") return `TEXT\n${block.text}`;
    if (block.type === "thinking") return `THINKING\n${block.thinking}`;
    if (block.type === "toolCall") return `TOOL CALL ${block.name}\n${JSON.stringify(block.arguments ?? {})}`;
    return JSON.stringify(block);
  });
  return `ASSISTANT\n${parts.join("\n\n")}`;
}

function normalizeCompactionBoundaryIndex(firstKeptEventIndex: number): number {
  if (!Number.isFinite(firstKeptEventIndex) || firstKeptEventIndex < 0) {
    throw new Error(`Invalid compaction boundary index: ${firstKeptEventIndex}`);
  }

  return Math.ceil(firstKeptEventIndex);
}

function getBoundaryAfterCompactedStart(startEventIndex: number): number {
  if (!Number.isFinite(startEventIndex) || startEventIndex < 0) {
    throw new Error(`Invalid compaction group start index: ${startEventIndex}`);
  }

  return Number.isInteger(startEventIndex) ? startEventIndex + 1 : Math.ceil(startEventIndex);
}

function getContextEventEntries(session: Session): Array<{ eventIndex: number; message: Message }> {
  const latestCompaction = getLatestSessionCompactionEvent(session);
  const startIndex = latestCompaction ? normalizeCompactionBoundaryIndex(latestCompaction.firstKeptEventIndex) : 0;
  const entries: Array<{ eventIndex: number; message: Message }> = [];

  if (latestCompaction?.firstKeptMessage) {
    entries.push({ eventIndex: startIndex - 0.5, message: latestCompaction.firstKeptMessage });
  }

  for (const [eventIndex, event] of session.events.entries()) {
    if (eventIndex < startIndex) continue;
    if (event.type !== "user_message" && event.type !== "assistant_message" && event.type !== "tool_result_message") continue;
    entries.push({ eventIndex, message: event.message });
  }

  return entries;
}

export function chooseCompactionBoundary(
  session: Session,
  keepRecentTokens = DEFAULT_KEEP_RECENT_TOKENS,
  protectedEventIndex?: number,
): BoundarySelection | undefined {
  const entries = getContextEventEntries(session);
  if (entries.length === 0) return undefined;

  const groups: Array<{
    startEventIndex: number;
    messages: Message[];
    tokens: number;
    startMessage: UserMessage | AssistantMessage;
    trailingMessages: Message[];
  }> = [];

  for (const entry of entries) {
    if (entry.message.role === "toolResult") {
      const current = groups.at(-1);
      if (!current) continue;
      current.messages.push(entry.message);
      current.trailingMessages.push(entry.message);
      current.tokens += estimateMessageTokens(entry.message);
      continue;
    }

    groups.push({
      startEventIndex: entry.eventIndex,
      messages: [entry.message],
      tokens: estimateMessageTokens(entry.message),
      startMessage: entry.message,
      trailingMessages: [],
    });
  }

  if (groups.length === 0) return undefined;

  const totalTokens = groups.reduce((total, group) => total + group.tokens, 0);
  if (totalTokens <= keepRecentTokens) return undefined;

  let keptTokens = 0;
  let firstKeptGroupIndex = groups.length;

  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const nextTokens = keptTokens + groups[index]!.tokens;
    if (nextTokens > keepRecentTokens) {
      firstKeptGroupIndex = index;
      break;
    }
    keptTokens = nextTokens;
    firstKeptGroupIndex = index;
  }

  const protectedUserGroupIndex = protectedEventIndex === undefined
    ? -1
    : groups.findIndex((current) => current.startEventIndex === protectedEventIndex && current.startMessage.role === "user");

  if (protectedUserGroupIndex >= 0 && firstKeptGroupIndex > protectedUserGroupIndex) {
    firstKeptGroupIndex = protectedUserGroupIndex;
  }

  const group = groups[firstKeptGroupIndex];
  if (!group) return undefined;

  const trailingTokens = group.trailingMessages.reduce((total, message) => total + estimateMessageTokens(message), 0) + keptTokens;
  const availableForStartMessage = Math.max(1, keepRecentTokens - trailingTokens);
  const startMessageTokens = estimateMessageTokens(group.startMessage);

  if (startMessageTokens > availableForStartMessage) {
    if (protectedUserGroupIndex === firstKeptGroupIndex) {
      return {
        firstKeptEventIndex: normalizeCompactionBoundaryIndex(group.startEventIndex),
        keptTokens: group.tokens + keptTokens,
        replacedMessages: groups.slice(0, firstKeptGroupIndex).flatMap((current) => current.messages),
      };
    }

    if (group.startMessage.role === "user") {
      const keepChars = Math.max(16, availableForStartMessage * 4);
      const content = group.startMessage.content.slice(-keepChars);
      const firstKeptMessage: UserMessage = { ...group.startMessage, content };
      return {
        firstKeptEventIndex: getBoundaryAfterCompactedStart(group.startEventIndex),
        firstKeptMessage,
        keptTokens: availableForStartMessage + trailingTokens,
        replacedMessages: groups.slice(0, firstKeptGroupIndex).flatMap((current) => current.messages).concat({ ...group.startMessage, content: group.startMessage.content.slice(0, -keepChars) }),
      };
    }

    const hasToolCalls = group.startMessage.content.some((block) => block.type === "toolCall");
    const hasNonTextContent = group.startMessage.content.some((block) => block.type !== "text");
    if (hasToolCalls || group.trailingMessages.length > 0 || hasNonTextContent) {
      const nextGroup = groups[firstKeptGroupIndex + 1];
      return {
        firstKeptEventIndex: nextGroup ? normalizeCompactionBoundaryIndex(nextGroup.startEventIndex) : session.events.length,
        keptTokens,
        replacedMessages: groups.slice(0, firstKeptGroupIndex + 1).flatMap((current) => current.messages),
      };
    }

    const text = group.startMessage.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n\n");
    const keepChars = Math.max(16, availableForStartMessage * 4);
    const suffix = text.slice(-keepChars) || text;
    const firstKeptMessage: AssistantMessage = {
      ...group.startMessage,
      content: [{ type: "text", text: `[compacted assistant suffix]\n${suffix}` }],
    };
    const replacedStart: AssistantMessage = {
      ...group.startMessage,
      content: [{ type: "text", text: text.slice(0, Math.max(0, text.length - keepChars)) }],
    };
    return {
      firstKeptEventIndex: getBoundaryAfterCompactedStart(group.startEventIndex),
      firstKeptMessage,
      keptTokens: availableForStartMessage + trailingTokens,
      replacedMessages: groups.slice(0, firstKeptGroupIndex).flatMap((current) => current.messages).concat(replacedStart),
    };
  }

  return {
    firstKeptEventIndex: normalizeCompactionBoundaryIndex(group.startEventIndex),
    keptTokens: group.tokens + keptTokens,
    replacedMessages: groups.slice(0, firstKeptGroupIndex).flatMap((current) => current.messages),
  };
}

function buildSummaryPrompt(previousSummary: string | undefined, replacedMessages: Message[]): string {
  const sections = [
    "Summarize this replaced session history for future continuation.",
    "Do not invent facts.",
    "Keep it concise and structured.",
    "Preserve exact identifiers, file paths, and error text.",
    "Include unresolved threads.",
    "Use sections: goal; constraints and preferences; progress; key decisions; next steps; critical context.",
  ];

  if (previousSummary) {
    sections.push(`Previous summary:\n${previousSummary}`);
  }

  sections.push(`Replaced history:\n${replacedMessages.map(serializeMessage).join("\n\n---\n\n") || "(none)"}`);
  return sections.join("\n\n");
}

async function summarizeMessages(model: unknown, apiKey: string, previousSummary: string | undefined, replacedMessages: Message[]): Promise<string> {
  const response = await completeSimple(model as Parameters<typeof completeSimple>[0], {
    systemPrompt: "You compact agent session history into a continuation-focused summary.",
    messages: [{ role: "user", content: buildSummaryPrompt(previousSummary, replacedMessages), timestamp: Date.now() }],
  }, {
    apiKey,
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return text || "No durable summary generated.";
}

export async function maybeCompactSession({
  model,
  apiKey,
  session,
  trigger,
  reserveTokens = DEFAULT_RESERVE_TOKENS,
  keepRecentTokens = DEFAULT_KEEP_RECENT_TOKENS,
  force = false,
  protectedEventIndex,
  onCompacting,
}: {
  model: unknown;
  apiKey: string;
  session: Session;
  trigger: CompactTrigger;
  reserveTokens?: number;
  keepRecentTokens?: number;
  force?: boolean;
  protectedEventIndex?: number;
  onCompacting?: () => void;
}): Promise<CompactionResult> {
  const contextWindow = typeof model === "object" && model !== null && "contextWindow" in model && typeof model.contextWindow === "number"
    ? model.contextWindow
    : undefined;

  const estimatedTokensBefore = estimateSessionContextTokens(session);
  if (!force && (!contextWindow || estimatedTokensBefore <= contextWindow - reserveTokens)) {
    return { compacted: false, estimatedTokensBefore };
  }

  const boundary = chooseCompactionBoundary(session, keepRecentTokens, protectedEventIndex);
  if (!boundary || boundary.replacedMessages.length === 0) {
    const estimatedRecentTokens = getSessionMessages(session).reduce((total, message) => total + estimateMessageTokens(message), 0);
    if (estimatedRecentTokens <= keepRecentTokens || (contextWindow && estimatedTokensBefore <= contextWindow - reserveTokens)) {
      return { compacted: false, estimatedTokensBefore };
    }
    return { compacted: false, estimatedTokensBefore, warning: "Session is over budget, but no safe compaction boundary was found." };
  }

  onCompacting?.();
  const previousSummary = getLatestSessionCompactionEvent(session)?.summary;
  const summary = await summarizeMessages(model, apiKey, previousSummary, boundary.replacedMessages);
  const event = await appendSessionCompactionEvent(session, {
    summary,
    firstKeptEventIndex: boundary.firstKeptEventIndex,
    estimatedTokensBefore,
    estimatedTokensAfter: estimateMessageTokens(createSyntheticSummaryMessage(summary)) + boundary.keptTokens,
    firstKeptMessage: boundary.firstKeptMessage,
    trigger,
  });
  return {
    compacted: true,
    event,
    estimatedTokensBefore,
    estimatedTokensAfter: event.estimatedTokensAfter,
  };
}

export function getSyntheticSummaryMessage(summary: string): AssistantMessage {
  return createSyntheticSummaryMessage(summary);
}
