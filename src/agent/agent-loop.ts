import { stream, type AssistantMessage, type Context, type Message, validateToolCall } from "@earendil-works/pi-ai";
import { createAgentContext, DEFAULT_SYSTEM_PROMPT } from "../lib/agent-context.js";
import { exposedTools, toolMap } from "./tools/index.js";
import type { AgentEvent, AgentTurnResult } from "./events.js";

export type AgentEventSink = (event: AgentEvent) => void | Promise<void>;

export type AgentLoopContext = {
  sessionId: string;
  prompt: string;
  systemPrompt?: string;
  messages: Message[];
  model: unknown;
  apiKey: string;
};

export type AgentLoopResult = {
  message: AssistantMessage;
  result: AgentTurnResult;
};

function getVisibleText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export async function runAgentLoop(context: AgentLoopContext, emit: AgentEventSink): Promise<AgentLoopResult> {
  await emit({ type: "agent_start", sessionId: context.sessionId, prompt: context.prompt });
  await emit({ type: "turn_start", sessionId: context.sessionId, prompt: context.prompt });

  while (true) {
    const llmContext: Context = {
      ...createAgentContext(context.messages),
      systemPrompt: context.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      tools: exposedTools,
    };

    const eventStream = stream(context.model as Parameters<typeof stream>[0], llmContext, { apiKey: context.apiKey });

    for await (const event of eventStream) {
      if (event.type === "text_start") {
        await emit({ type: "message_start", sessionId: context.sessionId, messageType: event.type });
      }
      if (event.type === "text_delta") {
        await emit({
          type: "message_delta",
          sessionId: context.sessionId,
          delta: event.delta,
          providerEvent: event,
        });
      }
    }

    const message = await eventStream.result();
    context.messages.push(message);

    const result: AgentTurnResult = {
      text: getVisibleText(message),
      stopReason: message.stopReason,
      errorMessage: message.errorMessage,
    };

    await emit({ type: "message_end", sessionId: context.sessionId, message, text: result.text });

    if (message.stopReason !== "toolUse") {
      await emit({ type: "turn_end", sessionId: context.sessionId, result });
      await emit({ type: "agent_end", sessionId: context.sessionId, result });
      return { message, result };
    }

    const toolCalls = message.content.filter((block) => block.type === "toolCall");

    for (const call of toolCalls) {
      try {
        const args = validateToolCall(exposedTools, call);
        const tool = toolMap[call.name as keyof typeof toolMap];

        if (!tool) {
          throw new Error(`Unknown tool: ${call.name}`);
        }

        const toolResult = await tool.run(args as never);

        context.messages.push({
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content: [{ type: "text", text: JSON.stringify(toolResult) }],
          isError: false,
          timestamp: Date.now(),
        });
      } catch (error) {
        context.messages.push({
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
          timestamp: Date.now(),
        });
      }
    }
  }
}
