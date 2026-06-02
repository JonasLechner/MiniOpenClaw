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

export type AgentEvent =
  | { type: "agent_start"; sessionId: string; prompt: string }
  | { type: "turn_start"; sessionId: string; prompt: string }
  | { type: "message_start"; sessionId: string; messageType: ProviderAssistantMessageEvent["type"] }
  | {
      type: "message_delta";
      sessionId: string;
      delta: string;
      providerEvent: Extract<ProviderAssistantMessageEvent, { type: "text_delta" }>;
    }
  | { type: "message_end"; sessionId: string; message: AssistantMessage; text: string }
  | {
      type: "tool_execution_start";
      sessionId: string;
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "tool_execution_end";
      sessionId: string;
      toolCallId: string;
      toolName: string;
      result: ToolResultMessage;
    }
  | { type: "compaction_start"; sessionId: string; trigger: "automatic" | "manual" }
  | {
      type: "compaction_end";
      sessionId: string;
      trigger: "automatic" | "manual";
      compacted: boolean;
      estimatedTokensBefore: number;
      estimatedTokensAfter?: number;
      warning?: string;
    }
  | { type: "turn_end"; sessionId: string; result: AgentTurnResult }
  | { type: "agent_end"; sessionId: string; result: AgentTurnResult }
  | { type: "agent_error"; sessionId: string; message: string; error: Error }
  | { type: "session_switched"; sessionId: string };

export type AgentEventListener = (event: AgentEvent) => void;
