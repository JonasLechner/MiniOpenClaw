import { type AssistantMessage, type Message, type ToolResultMessage } from "@earendil-works/pi-ai";
import type { Sandbox } from "../sandbox/sandbox.js";
import type { Workspace } from "../core/workspace.js";
import { getAssistantVisibleText } from "../core/messages.js";
import { generateAssistantTurn } from "./assistant-turn.js";
import { executeAssistantToolCalls } from "./tool-execution.js";
import type { ToolRunContext } from "./tools/types.js";
import type { ToolRegistry } from "./tools/tool-registry.js";
import type { AgentEvent, AgentTurnResult } from "./events.js";

export type AgentEventSink = (event: AgentEvent) => void | Promise<void>;

export type AgentLoopContext = {
  sessionId: string;
  runId: string;
  prompt: string;
  systemPrompt: string;
  messages: Message[];
  model: unknown;
  apiKey: string;
  workspace: Workspace;
  sandbox: Sandbox;
  reasoning?: string;
  signal?: AbortSignal;
  toolContext?: Pick<ToolRunContext, "channel" | "background">;
  toolRegistry: ToolRegistry;
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

function createAbortedAssistantMessage(context: AgentLoopContext): AssistantMessage {
  const model = context.model as { provider?: string; id?: string };
  return {
    role: "assistant",
    content: [{ type: "text", text: "Stopped." }],
    api: "openai-responses",
    provider: model.provider ?? "unknown",
    model: model.id ?? "unknown",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "aborted",
    errorMessage: "Aborted by user",
    timestamp: Date.now(),
  };
}

async function finishAborted(
  context: AgentLoopContext,
  generatedMessages: Array<AssistantMessage | ToolResultMessage>,
  emit: AgentEventSink,
): Promise<AgentLoopResult> {
  const message = createAbortedAssistantMessage(context);
  generatedMessages.push(message);
  const result: AgentTurnResult = {
    text: getAssistantVisibleText(message),
    stopReason: message.stopReason,
    errorMessage: message.errorMessage,
  };
  await emit({ type: "message_end", sessionId: context.sessionId, runId: context.runId, message, text: result.text });
  await emit({ type: "turn_end", sessionId: context.sessionId, runId: context.runId, result });
  await emit({ type: "agent_end", sessionId: context.sessionId, runId: context.runId, result });
  return { message, generatedMessages, result };
}

export async function runAgentLoop(context: AgentLoopContext, emit: AgentEventSink): Promise<AgentLoopResult> {
  const messages = [...context.messages];
  const generatedMessages: Array<AssistantMessage | ToolResultMessage> = [];

  try {
    await emit({ type: "agent_start", sessionId: context.sessionId, runId: context.runId, prompt: context.prompt });
    await emit({ type: "turn_start", sessionId: context.sessionId, runId: context.runId, prompt: context.prompt });

    while (true) {
      if (context.signal?.aborted) {
        return await finishAborted(context, generatedMessages, emit);
      }

      const { message, result } = await generateAssistantTurn(context, messages, emit);
      messages.push(message);
      generatedMessages.push(message);

      if (message.stopReason !== "toolUse") {
        await emit({ type: "turn_end", sessionId: context.sessionId, runId: context.runId, result });
        await emit({ type: "agent_end", sessionId: context.sessionId, runId: context.runId, result });
        return { message, generatedMessages, result };
      }

      const toolResults = await executeAssistantToolCalls(context, message, emit);
      messages.push(...toolResults);
      generatedMessages.push(...toolResults);

      if (context.signal?.aborted) {
        return await finishAborted(context, generatedMessages, emit);
      }
    }
  } catch (error) {
    if (context.signal?.aborted) {
      return await finishAborted(context, generatedMessages, emit);
    }
    throw new AgentLoopExecutionError(error, generatedMessages);
  }
}
