import { Agent } from "../agent.js";
import type { AgentEvent } from "../events.js";
import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  TextareaRenderable,
  StyledText,
  stringToStyledText,
  bold,
  dim,
  fg,
  t,
} from "@opentui/core";
import type { TextChunk, KeyEvent, CliRenderer } from "@opentui/core";

type MessageRole = "user" | "assistant" | "system";

interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  toolCalls?: { name: string; args: unknown }[];
  toolResults?: { name: string; result: string; isError: boolean }[];
  timestamp: number;
  isStreaming?: boolean;
}

interface StatusBarState {
  provider: string;
  model: string;
  sessionId: string;
  mode: "idle" | "thinking" | "streaming" | "tool";
  toolName?: string;
}

export class TuiApp {
  #renderer: CliRenderer | undefined;
  #chatScroll: ScrollBoxRenderable | undefined;
  #chatText: TextRenderable | undefined;
  #input: TextareaRenderable | undefined;
  #statusLeft: TextRenderable | undefined;
  #statusRight: TextRenderable | undefined;
  #agent: Agent;
  #isRunning = false;
  #currentMessageId?: string;
  #messages: ChatMessage[] = [];
  #status: StatusBarState = {
    provider: "",
    model: "",
    sessionId: "",
    mode: "idle",
  };
  #resolveStart?: () => void;
  #abortController?: AbortController;

  constructor(agent: Agent) {
    this.#agent = agent;
    this.#status = {
      provider: agent.provider,
      model: agent.modelId,
      sessionId: agent.sessionId,
      mode: "idle",
    };
  }

  async start(): Promise<void> {
    this.#renderer = await createCliRenderer({
      screenMode: "main-screen",
      exitOnCtrlC: false,
      autoFocus: true,
      useMouse: true,
      enableMouseMovement: false,
    });

    // Status bar
    const statusBox = new BoxRenderable(this.#renderer, {
      height: 1,
      backgroundColor: "#262626",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingLeft: 1,
      paddingRight: 1,
    });
    this.#statusLeft = new TextRenderable(this.#renderer, { content: "" });
    this.#statusRight = new TextRenderable(this.#renderer, { content: "" });
    statusBox.add(this.#statusLeft);
    statusBox.add(this.#statusRight);
    this.#renderer.root.add(statusBox);

    // Chat area
    this.#chatScroll = new ScrollBoxRenderable(this.#renderer, {
      flexGrow: 1,
      border: false,
      stickyScroll: true,
      stickyStart: "bottom",
    });
    this.#chatText = new TextRenderable(this.#renderer, {
      content: "",
      wrapMode: "word",
      paddingLeft: 2,
    });
    this.#chatScroll.add(this.#chatText);
    this.#renderer.root.add(this.#chatScroll);

    // Input area
    const inputBox = new BoxRenderable(this.#renderer, {
      height: 5,
      border: true,
      borderColor: "#444",
      borderStyle: "single",
      flexDirection: "column",
      paddingLeft: 1,
      paddingRight: 1,
    });
    this.#input = new TextareaRenderable(this.#renderer, {
      placeholder: "Type a message…  (Enter to send, Ctrl+C to quit)",
      wrapMode: "word",
      flexGrow: 1,
      backgroundColor: "transparent",
    });

    // Override key handling
    const originalHandleKeyPress = this.#input.handleKeyPress.bind(this.#input);
    this.#input.handleKeyPress = (key: KeyEvent): boolean => {
      if (key.ctrl && key.name === "c") {
        if (this.#status.mode !== "idle") {
          this.#abortController?.abort();
        } else {
          this.stop();
        }
        return true;
      }
      if (key.name === "escape") {
        if (this.#abortController) {
          this.#abortController.abort();
        }
        return true;
      }
      if (key.ctrl && key.name === "l") {
        this.#renderer!.requestRender();
        return true;
      }
      if (key.name === "return" && !key.shift && !key.ctrl && !key.meta) {
        if (this.#status.mode !== "idle") return true;
        const text = this.#input!.plainText.trim();
        if (text) {
          this.#handleSubmit(text);
          this.#input!.clear();
        }
        return true;
      }
      if (key.name === "pageup" || key.name === "pagedown") {
        this.#chatScroll!.handleKeyPress(key);
        return true;
      }
      if (key.name === "up" && key.shift) {
        this.#chatScroll!.scrollBy({ x: 0, y: -1 });
        return true;
      }
      if (key.name === "down" && key.shift) {
        this.#chatScroll!.scrollBy({ x: 0, y: 1 });
        return true;
      }
      return originalHandleKeyPress(key);
    };

    inputBox.add(this.#input);
    this.#renderer.root.add(inputBox);

    this.#renderer.root.flexDirection = "column";

    this.#isRunning = true;
    this.#renderer.start();

    this.#input.focus();

    // Listen to agent events
    this.#agent.onEvent((event) => this.#handleAgentEvent(event));

    // Show welcome
    this.#messages.push({
      id: "welcome",
      role: "system",
      text: `Welcome! Using ${this.#agent.provider}/${this.#agent.modelId}\nType a message and press Enter to send. Ctrl+C to quit.`,
      timestamp: Date.now(),
    });
    this.#chatText.content = this.#buildChatContent();
    this.#renderer.requestRender();

    return new Promise<void>((resolve) => {
      this.#resolveStart = resolve;
    });
  }

  stop(): void {
    if (!this.#isRunning) return;
    this.#isRunning = false;
    this.#renderer?.destroy();
    this.#resolveStart?.();
  }

  #buildChatContent(): StyledText {
    const chunks: TextChunk[] = [];

    for (const msg of this.#messages) {
      // Header
      const label = msg.role === "user"
        ? bold(fg("#5fd75f")("You"))
        : msg.role === "system"
          ? dim("System")
          : bold(fg("#5fd7d7")("LLM"));
      chunks.push(label);
      chunks.push(...stringToStyledText("\n").chunks);

      // Body
      if (msg.text) {
        const trimmed = msg.text.trimEnd();
        if (trimmed) {
          chunks.push(...stringToStyledText(trimmed + "\n").chunks);
        }
      }

      // Tool calls
      for (const tc of msg.toolCalls ?? []) {
        const line = `  ⚒ ${tc.name} ${JSON.stringify(tc.args).slice(0, 50)}`;
        chunks.push(...stringToStyledText(line).chunks);
        chunks.push(...stringToStyledText("\n").chunks);
      }

      // Tool results
      for (const tr of msg.toolResults ?? []) {
        chunks.push(...stringToStyledText("  ").chunks);
        chunks.push(tr.isError ? fg("#d75f5f")("✗") : fg("#5fd75f")("✓"));
        chunks.push(...stringToStyledText(` ${tr.name} `).chunks);
        chunks.push(dim(tr.result.slice(0, 50).replace(/\n/g, " ↵ ")));
        chunks.push(...stringToStyledText("\n").chunks);
      }

      // Streaming indicator
      if (msg.isStreaming) {
        chunks.push(...stringToStyledText("  ").chunks);
        chunks.push(fg("#5fd75f")("▌"));
        chunks.push(...stringToStyledText("\n").chunks);
      }
    }

    return new StyledText(chunks);
  }

  async #handleSubmit(text: string): Promise<void> {
    if (text === "/exit" || text === "/quit") {
      this.stop();
      return;
    }
    if (text === "/new") {
      try {
        await this.#agent.newSession();
      } catch (e) {
        this.#messages.push({
          id: `system-${Date.now()}`,
          role: "system",
          text: `Error creating session: ${e instanceof Error ? e.message : String(e)}`,
          timestamp: Date.now(),
        });
        if (this.#chatText) {
          this.#chatText.content = this.#buildChatContent();
        }
        this.#renderer?.requestRender();
      }
      return;
    }
    if (text === "/clear") {
      this.#messages = [];
      if (this.#chatText) {
        this.#chatText.content = this.#buildChatContent();
      }
      this.#renderer?.requestRender();
      return;
    }

    this.#messages.push({
      id: `user-${Date.now()}`,
      role: "user",
      text,
      timestamp: Date.now(),
    });

    if (this.#chatText) {
      this.#chatText.content = this.#buildChatContent();
    }
    this.#renderer?.requestRender();

    this.#abortController = new AbortController();
    try {
      await this.#agent.runLoop(text, { signal: this.#abortController.signal });
    } catch (err) {
      this.#messages.push({
        id: `system-${Date.now()}`,
        role: "system",
        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      });
      this.#setStatus("idle");
      if (this.#chatText) {
        this.#chatText.content = this.#buildChatContent();
      }
      this.#renderer?.requestRender();
    } finally {
      this.#abortController = undefined;
    }
  }

  #handleAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case "agent_start":
        this.#setStatus("thinking");
        break;
      case "message_start": {
        const msgId = `assistant-${Date.now()}`;
        this.#messages.push({
          id: msgId,
          role: "assistant",
          text: "",
          isStreaming: true,
          timestamp: Date.now(),
        });
        this.#currentMessageId = msgId;
        this.#setStatus("thinking");
        if (this.#chatText) {
          this.#chatText.content = this.#buildChatContent();
        }
        this.#renderer?.requestRender();
        break;
      }
      case "message_delta":
        if (this.#currentMessageId) {
          const msg = this.#messages.find((m) => m.id === this.#currentMessageId);
          if (msg) {
            msg.text += event.delta;
          }
          this.#setStatus("streaming");
          if (this.#chatText) {
            this.#chatText.content = this.#buildChatContent();
          }
          this.#renderer?.requestRender();
        }
        break;
      case "message_end": {
        if (this.#currentMessageId) {
          const msg = this.#messages.find((m) => m.id === this.#currentMessageId);
          if (msg) msg.isStreaming = false;
        }
        break;
      }
      case "tool_execution_start": {
        if (!this.#currentMessageId) {
          const msgId = `assistant-${Date.now()}`;
          this.#messages.push({
            id: msgId,
            role: "assistant",
            text: "",
            isStreaming: false,
            timestamp: Date.now(),
          });
          this.#currentMessageId = msgId;
        }
        const msg = this.#messages.find((m) => m.id === this.#currentMessageId);
        if (msg) {
          if (!msg.toolCalls) msg.toolCalls = [];
          msg.toolCalls.push({ name: event.toolName, args: event.args });
        }
        this.#setStatus("tool", event.toolName);
        if (this.#chatText) {
          this.#chatText.content = this.#buildChatContent();
        }
        this.#renderer?.requestRender();
        break;
      }
      case "tool_execution_end":
        if (this.#currentMessageId) {
          const msg = this.#messages.find((m) => m.id === this.#currentMessageId);
          if (msg) {
            if (!msg.toolResults) msg.toolResults = [];
            msg.toolResults.push({
              name: event.toolName,
              result: event.result.content.map((c) => (c.type === "text" ? c.text : "")).join(""),
              isError: event.result.isError,
            });
          }
        }
        this.#setStatus("idle");
        if (this.#chatText) {
          this.#chatText.content = this.#buildChatContent();
        }
        this.#renderer?.requestRender();
        break;
      case "agent_end": {
        if (this.#currentMessageId) {
          const msg = this.#messages.find((m) => m.id === this.#currentMessageId);
          if (msg) msg.isStreaming = false;
        }
        this.#currentMessageId = undefined;
        this.#setStatus("idle");
        if (this.#chatText) {
          this.#chatText.content = this.#buildChatContent();
        }
        this.#renderer?.requestRender();
        break;
      }
      case "agent_error": {
        if (this.#currentMessageId) {
          const msg = this.#messages.find((m) => m.id === this.#currentMessageId);
          if (msg) {
            msg.isStreaming = false;
            msg.text += `\nError: ${event.message}`;
          }
        }
        this.#currentMessageId = undefined;
        this.#setStatus("idle");
        if (this.#chatText) {
          this.#chatText.content = this.#buildChatContent();
        }
        this.#renderer?.requestRender();
        break;
      }
      case "session_switched":
        this.#status.sessionId = event.sessionId;
        this.#messages.push({
          id: `system-${Date.now()}`,
          role: "system",
          text: `Switched to session ${event.sessionId.slice(0, 8)}`,
          timestamp: Date.now(),
        });
        this.#setStatus(this.#status.mode); // refresh status bar
        if (this.#chatText) {
          this.#chatText.content = this.#buildChatContent();
        }
        this.#renderer?.requestRender();
        break;
    }
  }

  #setStatus(mode: StatusBarState["mode"], toolName?: string): void {
    this.#status.mode = mode;
    this.#status.toolName = toolName;

    if (!this.#statusLeft || !this.#statusRight) return;

    this.#statusLeft.content = t`${bold("MiniOpenClaw")}  ${fg("#5f87ff")(this.#status.provider)}/${fg("#5fd7d7")(this.#status.model)}  ${dim("session:")} ${fg("#8a8a8a")(this.#status.sessionId.slice(0, 8))}`;

    let rightText: string;
    let rightColor: string;
    switch (mode) {
      case "thinking":
        rightText = "◐ thinking";
        rightColor = "#d7af5f";
        break;
      case "streaming":
        rightText = "● streaming";
        rightColor = "#5fd75f";
        break;
      case "tool":
        rightText = `⚒ ${toolName ?? "tool"}`;
        rightColor = "#ff8700";
        break;
      default:
        rightText = "○ idle";
        rightColor = "#8a8a8a";
    }
    this.#statusRight.content = new StyledText([fg(rightColor)(rightText)]);
  }
}
