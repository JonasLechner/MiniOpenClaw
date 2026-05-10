import type { AssistantMessage, AssistantMessageEvent as ProviderAssistantMessageEvent } from "@earendil-works/pi-ai";

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
  | { type: "turn_end"; sessionId: string; result: AgentTurnResult }
  | { type: "agent_end"; sessionId: string; result: AgentTurnResult }
  | { type: "agent_error"; sessionId: string; message: string; error: Error }
  | { type: "session_switched"; sessionId: string };

export type AgentEventListener = (event: AgentEvent) => void;
