import type { FastifyReply, FastifyRequest } from "fastify";
import { createLogger } from "../core/log.js";

const requestStartTime = Symbol("requestStartTime");

type RequestWithStart = FastifyRequest & { [requestStartTime]?: number };

const gatewayLogger = createLogger({ component: "gateway" });

export function markGatewayRequestStart(request: FastifyRequest): void {
  (request as RequestWithStart)[requestStartTime] = Date.now();
}

export function logGatewayListening(address: string): void {
  gatewayLogger.info("gateway_started", { address });
}

export function logGatewaySandboxStart(sessionId: string, engine: string, image?: string): void {
  gatewayLogger.info("sandbox_starting", { sessionId, engine, image });
}

export function logGatewaySandboxReady(sessionId: string, engine: string, durationMs: number, image?: string): void {
  gatewayLogger.info("sandbox_ready", { sessionId, engine, image, durationMs });
}

export function logGatewaySandboxError(sessionId: string, engine: string, durationMs: number, error: Error, image?: string): void {
  gatewayLogger.error("sandbox_failed", {
    sessionId,
    engine,
    image,
    durationMs,
    message: error.message,
    error,
  });
}

export function logGatewayRequest(request: FastifyRequest, reply: FastifyReply): void {
  const startedAt = (request as RequestWithStart)[requestStartTime] ?? Date.now();
  gatewayLogger.info("gateway_request_completed", {
    method: request.method,
    url: request.url,
    statusCode: reply.statusCode,
    durationMs: Date.now() - startedAt,
    remoteAddress: request.ip,
  });
}

export function logGatewayError(request: FastifyRequest, error: Error): void {
  gatewayLogger.error("gateway_request_failed", {
    method: request.method,
    url: request.url,
    remoteAddress: request.ip,
    message: error.message,
    error,
  });
}

export function logGatewayAuthWarning(provider: string, authFile: string): void {
  gatewayLogger.warn("gateway_auth_warning", {
    provider,
    authFile,
    message: `No authentication configured for provider "${provider}". Run "npm run auth" to authenticate interactively, or add an API key to ${authFile}.`,
  });
}
