import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import type { Sandbox } from "../sandbox/sandbox.js";
import type { Workspace } from "../core/workspace.js";
import { exposedTools, toolMap } from "./tools/tool-registry.js";
import type { ToolRunContext, ToolRunResult } from "./tools/types.js";
import { validateToolCall } from "@earendil-works/pi-ai";
import type { AgentEventSink } from "./agent-loop.js";

export type ExecuteToolCallsContext = {
  sessionId: string;
  runId: string;
  workspace: Workspace;
  sandbox: Sandbox;
  signal?: AbortSignal;
  toolContext?: Pick<ToolRunContext, "channel" | "background">;
};

function isToolRunResult(result: unknown): result is ToolRunResult {
  return Boolean(
    result
    && typeof result === "object"
    && "content" in result
    && Array.isArray((result as { content?: unknown }).content),
  );
}

function normalizeToolResult(result: unknown): ToolRunResult {
  if (isToolRunResult(result)) {
    return result;
  }

  return {
    content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
  };
}

export async function executeAssistantToolCalls(
  context: ExecuteToolCallsContext,
  message: AssistantMessage,
  emit: AgentEventSink,
): Promise<ToolResultMessage[]> {
  const toolCalls = message.content.filter((block) => block.type === "toolCall");
  const results: ToolResultMessage[] = [];

  for (const call of toolCalls) {
    if (context.signal?.aborted) {
      break;
    }

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
        runId: context.runId,
        toolCallId,
        toolName: call.name,
        args,
      });

      const toolRunContext: ToolRunContext = {
        workspace: context.workspace,
        sandbox: context.sandbox,
        signal: context.signal,
        ...context.toolContext,
      };

      const runResult = normalizeToolResult(await tool.run(args as never, toolRunContext));
      const toolResult: ToolResultMessage = {
        role: "toolResult",
        toolCallId,
        toolName: call.name,
        content: runResult.content,
        details: runResult.details,
        isError: false,
        timestamp: Date.now(),
      };

      results.push(toolResult);
      await emit({
        type: "tool_execution_end",
        sessionId: context.sessionId,
        runId: context.runId,
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

      results.push(toolResult);
      await emit({
        type: "tool_execution_end",
        sessionId: context.sessionId,
        runId: context.runId,
        toolCallId,
        toolName: call.name,
        result: toolResult,
      });
    }
  }

  return results;
}
