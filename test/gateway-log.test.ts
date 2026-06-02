import { afterEach, describe, expect, it, vi } from "vitest";

const originalIsTTY = process.stdout.isTTY;

function captureConsole() {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  return { logSpy };
}

afterEach(() => {
  Object.defineProperty(process.stdout, "isTTY", {
    value: originalIsTTY,
    configurable: true,
  });
  vi.restoreAllMocks();
});

describe("gateway and conversation logging", () => {
  it("emits structured JSON conversation message logs when stdout is not a TTY", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    const { logSpy } = captureConsole();
    const { logConversationMessage } = await import("../src/gateway/conversation-log.js");

    logConversationMessage({
      role: "assistant",
      source: "telegram-detached",
      chatId: "chat-1",
      userId: "user-1",
      taskId: "task-1",
      stopReason: "stop",
      text: "done",
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload).toMatchObject({
      event: "conversation_message",
      role: "assistant",
      source: "telegram-detached",
      chatId: "chat-1",
      userId: "user-1",
      taskId: "task-1",
      stopReason: "stop",
      text: "done",
    });
  });

  it("emits structured JSON conversation tool call logs with duration and error flag", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    const { logSpy } = captureConsole();
    const { logConversationToolCall } = await import("../src/gateway/conversation-log.js");

    logConversationToolCall({
      phase: "end",
      source: "scheduled-detached",
      chatId: "chat-1",
      taskId: "task-1",
      toolCallId: "call-1",
      toolName: "bash",
      durationMs: 123,
      isError: true,
    });

    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload).toMatchObject({
      event: "conversation_tool_call",
      phase: "end",
      source: "scheduled-detached",
      chatId: "chat-1",
      taskId: "task-1",
      toolCallId: "call-1",
      toolName: "bash",
      durationMs: 123,
      isError: true,
    });
  });

  it("logs gateway request timing using the marked request start", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    const { logSpy } = captureConsole();
    const { markGatewayRequestStart, logGatewayRequest } = await import("../src/gateway/log.js");

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1000);
    const request = { method: "GET", url: "/health", ip: "127.0.0.1" } as never;
    markGatewayRequestStart(request);
    nowSpy.mockReturnValueOnce(1125);
    logGatewayRequest(request, { statusCode: 200 } as never);

    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload).toMatchObject({
      event: "gateway_request",
      method: "GET",
      url: "/health",
      statusCode: 200,
      durationMs: 125,
      remoteAddress: "127.0.0.1",
    });
  });

  it("logs gateway auth warnings as structured JSON", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    const { logSpy } = captureConsole();
    const { logGatewayAuthWarning } = await import("../src/gateway/log.js");

    logGatewayAuthWarning("openai-codex", "/tmp/auth.json");

    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload).toMatchObject({
      event: "gateway_auth_warning",
      method: "-",
      url: "-",
    });
    expect(String(payload.message)).toContain("openai-codex");
    expect(String(payload.message)).toContain("/tmp/auth.json");
  });
});
