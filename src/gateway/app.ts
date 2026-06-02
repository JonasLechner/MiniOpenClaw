import Fastify, { type FastifyInstance } from "fastify";
import type { RuntimeState } from "../lib/runtime.js";
import { createNewSession, ensureCurrentSession, getSessionById, listSessions } from "../lib/sessions.js";
import { toSessionResponse } from "./session-response.js";

export function buildGateway(runtime: RuntimeState): FastifyInstance {
  const app = Fastify({ logger: true });

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
