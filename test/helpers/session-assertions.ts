import { expect } from "vitest";
import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";
import { getSessionById, getSessionMessages, listSessions, type Session } from "../../src/core/sessions.js";
import type { RuntimePaths } from "../../src/core/config.js";

export async function loadOnlySession(paths: RuntimePaths): Promise<Session> {
  const [sessionSummary] = await listSessions(paths);
  expect(sessionSummary).toBeDefined();
  const session = await getSessionById(paths, sessionSummary!.sessionId);
  expect(session).toBeDefined();
  return session!;
}

export function getToolResultMessages(session: Session): ToolResultMessage[] {
  return getSessionMessages(session).filter((message): message is ToolResultMessage => message.role === "toolResult");
}

export function getToolResultText(message: ToolResultMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function expectToolResultsToMatchAssistantCalls(messages: Message[]): void {
  const assistantToolCallIds = new Set(
    messages.flatMap((message) => message.role === "assistant"
      ? message.content.filter((block) => block.type === "toolCall").map((block) => block.id)
      : []),
  );

  for (const message of messages) {
    if (message.role !== "toolResult") continue;
    expect(assistantToolCallIds.has(message.toolCallId)).toBe(true);
    assistantToolCallIds.delete(message.toolCallId);
  }

  expect(assistantToolCallIds.size).toBe(0);
}

export function expectSessionEventTypes(session: Session, expected: string[]): void {
  expect(session.events.map((event) => event.type)).toEqual(expected);
}
