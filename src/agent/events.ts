import type {
  AssistantMessage,
  AssistantMessageEvent as ProviderAssistantMessageEvent,
  ToolResultMessage,
} from "@earendil-works/pi-ai";

export type AgentTurnResult = {
  text: string;
  stopReason: AssistantMessage["stopReason"];
  errorMessage?: string;
};

type RunScopedEvent = {
  sessionId: string;
  runId: string;
};

export type AgentEvent =
  | ({ type: "agent_start"; prompt: string } & RunScopedEvent)
  | ({ type: "turn_start"; prompt: string } & RunScopedEvent)
  | ({ type: "message_start"; messageType: ProviderAssistantMessageEvent["type"] } & RunScopedEvent)
  | ({
      type: "message_delta";
      delta: string;
      providerEvent: Extract<ProviderAssistantMessageEvent, { type: "text_delta" }>;
    } & RunScopedEvent)
  | ({ type: "message_end"; message: AssistantMessage; text: string } & RunScopedEvent)
  | ({
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args: unknown;
    } & RunScopedEvent)
  | ({
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: ToolResultMessage;
    } & RunScopedEvent)
  | ({ type: "compaction_start"; trigger: "automatic" | "manual" } & RunScopedEvent)
  | ({
      type: "compaction_end";
      trigger: "automatic" | "manual";
      compacted: boolean;
      estimatedTokensBefore: number;
      estimatedTokensAfter?: number;
      warning?: string;
    } & RunScopedEvent)
  | ({ type: "turn_end"; result: AgentTurnResult } & RunScopedEvent)
  | ({ type: "agent_end"; result: AgentTurnResult } & RunScopedEvent)
  | ({ type: "agent_error"; message: string; error: Error } & RunScopedEvent)
  | { type: "session_switched"; sessionId: string };

export type AgentEventListener = (event: AgentEvent) => void;
