import type { FastifyReply, FastifyRequest } from "fastify";

const ansi = {
  dim: "\u001b[2m",
  reset: "\u001b[0m",
  blue: "\u001b[34m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  gray: "\u001b[90m",
} as const;

const requestStartTime = Symbol("requestStartTime");

type RequestWithStart = FastifyRequest & { [requestStartTime]?: number };

type GatewayLogEvent =
  | {
      event: "gateway_listening";
      timestamp: string;
      address: string;
    }
  | {
      event: "gateway_sandbox_start";
      timestamp: string;
      sessionId: string;
      engine: string;
      image?: string;
    }
  | {
      event: "gateway_sandbox_ready";
      timestamp: string;
      sessionId: string;
      engine: string;
      image?: string;
      durationMs: number;
    }
  | {
      event: "gateway_sandbox_error";
      timestamp: string;
      sessionId: string;
      engine: string;
      image?: string;
      durationMs: number;
      message: string;
    }
  | {
      event: "gateway_request";
      timestamp: string;
      method: string;
      url: string;
      statusCode: number;
      durationMs: number;
      remoteAddress?: string;
    }
  | {
      event: "gateway_error";
      timestamp: string;
      method: string;
      url: string;
      message: string;
      remoteAddress?: string;
    }
  | {
      event: "gateway_auth_warning";
      timestamp: string;
      method: string;
      url: string;
      message: string;
    };

function color(text: string, value: string): string {
  return `${value}${text}${ansi.reset}`;
}

function formatTimestamp(timestamp: string): string {
  return color(new Date(timestamp).toISOString().slice(11, 23), ansi.dim);
}

function formatMeta(meta: Record<string, string | number | undefined>): string {
  const parts = Object.entries(meta)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${color(key, ansi.gray)}=${value}`);
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function writeLogLine(pretty: string, json: GatewayLogEvent): void {
  if (process.stdout.isTTY) {
    console.log(pretty);
    return;
  }

  console.log(JSON.stringify(json));
}

export function markGatewayRequestStart(request: FastifyRequest): void {
  (request as RequestWithStart)[requestStartTime] = Date.now();
}

export function logGatewayListening(address: string): void {
  const payload: GatewayLogEvent = {
    event: "gateway_listening",
    timestamp: new Date().toISOString(),
    address,
  };

  writeLogLine(
    `${formatTimestamp(payload.timestamp)} ${color("gateway", ansi.blue)} ${color("listening", ansi.green)} ${payload.address}`,
    payload,
  );
}

export function logGatewaySandboxStart(sessionId: string, engine: string, image?: string): void {
  const payload: GatewayLogEvent = {
    event: "gateway_sandbox_start",
    timestamp: new Date().toISOString(),
    sessionId,
    engine,
    image,
  };

  const pretty = [
    formatTimestamp(payload.timestamp),
    color("sandbox", ansi.blue),
    color("starting", ansi.yellow),
    formatMeta({ session: payload.sessionId, engine: payload.engine, image: payload.image }),
  ].join(" ");

  writeLogLine(pretty, payload);
}

export function logGatewaySandboxReady(sessionId: string, engine: string, durationMs: number, image?: string): void {
  const payload: GatewayLogEvent = {
    event: "gateway_sandbox_ready",
    timestamp: new Date().toISOString(),
    sessionId,
    engine,
    image,
    durationMs,
  };

  const pretty = [
    formatTimestamp(payload.timestamp),
    color("sandbox", ansi.blue),
    color("ready", ansi.green),
    formatMeta({ session: payload.sessionId, engine: payload.engine, image: payload.image, ms: payload.durationMs }),
  ].join(" ");

  writeLogLine(pretty, payload);
}

export function logGatewaySandboxError(sessionId: string, engine: string, durationMs: number, error: Error, image?: string): void {
  const payload: GatewayLogEvent = {
    event: "gateway_sandbox_error",
    timestamp: new Date().toISOString(),
    sessionId,
    engine,
    image,
    durationMs,
    message: error.message,
  };

  const pretty = [
    formatTimestamp(payload.timestamp),
    color("sandbox", ansi.blue),
    color("error", ansi.red),
    formatMeta({ session: payload.sessionId, engine: payload.engine, image: payload.image, ms: payload.durationMs }),
    payload.message,
  ].join(" ");

  writeLogLine(pretty, payload);
}

export function logGatewayRequest(request: FastifyRequest, reply: FastifyReply): void {
  const startedAt = (request as RequestWithStart)[requestStartTime] ?? Date.now();
  const payload: GatewayLogEvent = {
    event: "gateway_request",
    timestamp: new Date().toISOString(),
    method: request.method,
    url: request.url,
    statusCode: reply.statusCode,
    durationMs: Date.now() - startedAt,
    remoteAddress: request.ip,
  };

  const statusColor = payload.statusCode >= 500 ? ansi.red : payload.statusCode >= 400 ? ansi.yellow : ansi.green;
  const pretty = [
    formatTimestamp(payload.timestamp),
    color("http", ansi.blue),
    color(payload.method, ansi.blue),
    payload.url,
    color(String(payload.statusCode), statusColor),
    formatMeta({ ms: payload.durationMs, ip: payload.remoteAddress }),
  ].join(" ");

  writeLogLine(pretty, payload);
}

export function logGatewayError(request: FastifyRequest, error: Error): void {
  const payload: GatewayLogEvent = {
    event: "gateway_error",
    timestamp: new Date().toISOString(),
    method: request.method,
    url: request.url,
    message: error.message,
    remoteAddress: request.ip,
  };

  const pretty = [
    formatTimestamp(payload.timestamp),
    color("http", ansi.blue),
    color("error", ansi.red),
    color(payload.method, ansi.blue),
    payload.url,
    formatMeta({ ip: payload.remoteAddress }),
    payload.message,
  ].join(" ");

  writeLogLine(pretty, payload);
}

export function logGatewayAuthWarning(provider: string, authFile: string): void {
  const timestamp = new Date().toISOString();
  const message = `No authentication configured for provider "${provider}". Run "npm run auth" to authenticate interactively, or add an API key to ${authFile}.`;

  const payload: GatewayLogEvent = {
    event: "gateway_auth_warning",
    timestamp,
    method: "-",
    url: "-",
    message,
  };

  const pretty = [
    formatTimestamp(timestamp),
    color("auth", ansi.blue),
    color("warning", ansi.yellow),
    message,
  ].join(" ");

  writeLogLine(pretty, payload);
}
