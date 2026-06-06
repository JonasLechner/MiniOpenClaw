import { streamSimple, type AssistantMessage, type Context, type ThinkingLevel, type Message } from "@earendil-works/pi-ai";
import { createAgentContext } from "../core/agent-context.js";
import { getAssistantVisibleText } from "../core/messages.js";
import type { AgentEventSink, AgentLoopContext } from "./agent-loop.js";
import type { AgentTurnResult } from "./events.js";

export type AssistantTurnOutput = {
  message: AssistantMessage;
  result: AgentTurnResult;
};

export async function generateAssistantTurn(
  context: AgentLoopContext,
  messages: Message[],
  emit: AgentEventSink,
): Promise<AssistantTurnOutput> {
  const llmContext: Context = {
    ...createAgentContext(messages, context.systemPrompt),
    tools: context.toolRegistry.exposedTools,
  };

  const eventStream = streamSimple(context.model as Parameters<typeof streamSimple>[0], llmContext, {
    apiKey: context.apiKey,
    reasoning: context.reasoning as ThinkingLevel | undefined,
    signal: context.signal,
  });

  for await (const event of eventStream) {
    if (event.type === "text_start") {
      await emit({ type: "message_start", sessionId: context.sessionId, runId: context.runId, messageType: event.type });
    }
    if (event.type === "text_delta") {
      await emit({
        type: "message_delta",
        sessionId: context.sessionId,
        runId: context.runId,
        delta: event.delta,
        providerEvent: event,
      });
    }
  }

  const message = await eventStream.result();
  const result: AgentTurnResult = {
    text: getAssistantVisibleText(message),
    stopReason: message.stopReason,
    errorMessage: message.errorMessage,
  };

  await emit({ type: "message_end", sessionId: context.sessionId, runId: context.runId, message, text: result.text });
  return { message, result };
}
