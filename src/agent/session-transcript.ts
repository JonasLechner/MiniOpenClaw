import type { AssistantMessage, Message, ToolResultMessage } from "@earendil-works/pi-ai";
import {
  appendAssistantMessageEvent,
  appendErrorEvent,
  appendToolResultMessageEvent,
  appendUserMessageEvent,
  getSessionMessages,
  type Session,
  type UserMessageEvent,
} from "../core/sessions.js";

export class SessionTranscriptStore {
  #session: Session;

  constructor(session: Session) {
    this.#session = session;
  }

  get session(): Session {
    return this.#session;
  }

  replaceSession(session: Session): void {
    this.#session = session;
  }

  getMessages(): Message[] {
    return getSessionMessages(this.#session);
  }

  appendUserPrompt(prompt: string): Promise<UserMessageEvent> {
    return appendUserMessageEvent(this.#session, prompt);
  }

  async persistGeneratedMessages(messages: Array<AssistantMessage | ToolResultMessage>): Promise<void> {
    for (const message of messages) {
      if (message.role === "assistant") {
        await appendAssistantMessageEvent(this.#session, message);
        continue;
      }

      await appendToolResultMessageEvent(this.#session, message);
    }
  }

  appendRunError(message: string, details?: unknown): Promise<void> {
    return appendErrorEvent(this.#session, message, details).then(() => undefined);
  }
}
