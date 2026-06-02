import {
  streamSimple,
  type AssistantMessage,
  type Context,
  type Message,
  type ThinkingLevel,
  type ToolResultMessage,
  validateToolCall,
} from "@earendil-works/pi-ai";
import type { Sandbox } from "../lib/sandbox.js";
import type { Workspace } from "../lib/workspace.js";
import { createAgentContext } from "../lib/agent-context.js";
import { getAssistantVisibleText } from "../lib/messages.js";
import { exposedTools, toolMap } from "./tools/index.js";
import type { ToolRunContext } from "./tools/types.js";
import type { AgentEvent, AgentTurnResult } from "./events.js";

export type AgentEventSink = (event: AgentEvent) => void | Promise<void>;

export type AgentLoopContext = {
  sessionId: string;
  prompt: string;
  systemPrompt: string;
  messages: Message[];
  model: unknown;
  apiKey: string;
  workspace: Workspace;
  sandbox: Sandbox;
  reasoning?: string;
  signal?: AbortSignal;
};

export type AgentLoopResult = {
  message: AssistantMessage;
  generatedMessages: Array<AssistantMessage | ToolResultMessage>;
  result: AgentTurnResult;
};

export class AgentLoopExecutionError extends Error {
  readonly generatedMessages: Array<AssistantMessage | ToolResultMessage>;

  constructor(error: unknown, generatedMessages: Array<AssistantMessage | ToolResultMessage>) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
    this.name = "AgentLoopExecutionError";
    this.generatedMessages = generatedMessages;
  }
}

export async function runAgentLoop(context: AgentLoopContext, emit: AgentEventSink): Promise<AgentLoopResult> {
  const messages = [...context.messages];
  const generatedMessages: Array<AssistantMessage | ToolResultMessage> = [];

  try {
    await emit({ type: "agent_start", sessionId: context.sessionId, prompt: context.prompt });
    await emit({ type: "turn_start", sessionId: context.sessionId, prompt: context.prompt });

    while (true) {
      const llmContext: Context = {
        ...createAgentContext(messages, context.systemPrompt),
        tools: exposedTools,
      };

      const eventStream = streamSimple(context.model as Parameters<typeof streamSimple>[0], llmContext, {
        apiKey: context.apiKey,
        reasoning: context.reasoning as ThinkingLevel | undefined,
        signal: context.signal,
      });

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
      messages.push(message);
      generatedMessages.push(message);

      const result: AgentTurnResult = {
        text: getAssistantVisibleText(message),
        stopReason: message.stopReason,
        errorMessage: message.errorMessage,
      };

      await emit({ type: "message_end", sessionId: context.sessionId, message, text: result.text });

      if (message.stopReason !== "toolUse") {
        await emit({ type: "turn_end", sessionId: context.sessionId, result });
        await emit({ type: "agent_end", sessionId: context.sessionId, result });
        return { message, generatedMessages, result };
      }

      const toolCalls = message.content.filter((block) => block.type === "toolCall");

      for (const call of toolCalls) {
        const toolCallId = call.id;

        try {
          const args = validateToolCall(exposedTools, call);
          const tool = toolMap[call.name as keyof typeof toolMap];

          if (!tool) {
            throw new Error(`Unknown tool: ${call.name}`);
          }

          await emit({
            type: "tool_execution_start",
            sessionId: context.sessionId,
            toolCallId,
            toolName: call.name,
            args,
          });

          const toolContext: ToolRunContext = {
            workspace: context.workspace,
            sandbox: context.sandbox,
          };

          const toolResult: ToolResultMessage = {
            role: "toolResult",
            toolCallId,
            toolName: call.name,
            content: [{ type: "text", text: JSON.stringify(await tool.run(args as never, toolContext)) }],
            isError: false,
            timestamp: Date.now(),
          };

          messages.push(toolResult);
          generatedMessages.push(toolResult);
          await emit({
            type: "tool_execution_end",
            sessionId: context.sessionId,
            toolCallId,
            toolName: call.name,
            result: toolResult,
          });
        } catch (error) {
          const toolResult: ToolResultMessage = {
            role: "toolResult",
            toolCallId,
            toolName: call.name,
            content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
            isError: true,
            timestamp: Date.now(),
          };

          messages.push(toolResult);
          generatedMessages.push(toolResult);
          await emit({
            type: "tool_execution_end",
            sessionId: context.sessionId,
            toolCallId,
            toolName: call.name,
            result: toolResult,
          });
        }
      }
    }
  } catch (error) {
    throw new AgentLoopExecutionError(error, generatedMessages);
  }
}
