import Fastify, { type FastifyInstance } from "fastify";
import type { RuntimeState } from "../core/runtime.js";
import { createNewSession, ensureCurrentSession, getSessionById, listSessions } from "../core/sessions.js";
import { createMainSessionAgent } from "./agent-runner.js";
import { logGatewayError, logGatewayRequest, markGatewayRequestStart } from "./log.js";
import { createGatewayScheduler } from "../jobs/scheduler.js";
import { toSessionResponse } from "./session-response.js";
import { buildTelegramGatewayApp } from "../transports/telegram/app.js";

export function buildGateway(runtime: RuntimeState): FastifyInstance {
  const app = Fastify({ logger: false });
  const mainSessionAgent = createMainSessionAgent(runtime);
  const telegramApp = buildTelegramGatewayApp(runtime, mainSessionAgent);
  const scheduler = createGatewayScheduler(runtime, telegramApp?.streamer, mainSessionAgent);

  app.addHook("onRequest", async (request) => {
    markGatewayRequestStart(request);
  });

  app.addHook("onResponse", async (request, reply) => {
    logGatewayRequest(request, reply);
  });

  app.addHook("onError", async (request, _reply, error) => {
    logGatewayError(request, error);
  });

  app.addHook("onReady", async () => {
    await telegramApp?.start();
    scheduler.start();
  });

  app.addHook("onClose", async () => {
    scheduler.stop();
    await telegramApp?.stop();
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/sessions", async () => {
    return { sessions: await listSessions(runtime.paths) };
  });

  app.get("/sessions/current", async () => {
    const session = await ensureCurrentSession(runtime.paths);
    return toSessionResponse(session);
  });

  app.post("/sessions/new", async () => {
    const session = await createNewSession(runtime.paths);
    return toSessionResponse(session);
  });

  app.get<{ Params: { sessionId: string } }>("/sessions/:sessionId/events", async (request, reply) => {
    const session = await getSessionById(runtime.paths, request.params.sessionId);

    if (!session) {
      reply.code(404);
      return { error: `Unknown session ${request.params.sessionId}` };
    }

    return toSessionResponse(session);
  });

  return app;
}
