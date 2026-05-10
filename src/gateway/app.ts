import Fastify, { type FastifyInstance } from "fastify";
import { initializeRuntime } from "../lib/runtime.js";
import { createNewSession, ensureCurrentSession, getSessionById, listSessions } from "../lib/sessions.js";

export function buildGateway(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/sessions", async () => {
    const runtime = initializeRuntime();
    return { sessions: await listSessions(runtime.paths) };
  });

  app.get("/sessions/current", async () => {
    const runtime = initializeRuntime();
    const session = await ensureCurrentSession(runtime.paths);
    return {
      sessionId: session.header.sessionId,
      createdAt: session.header.createdAt,
      path: session.path,
      events: session.events,
    };
  });

  app.post("/sessions/new", async () => {
    const runtime = initializeRuntime();
    const session = await createNewSession(runtime.paths);
    return {
      sessionId: session.header.sessionId,
      createdAt: session.header.createdAt,
      path: session.path,
      events: session.events,
    };
  });

  app.get<{ Params: { sessionId: string } }>("/sessions/:sessionId/events", async (request, reply) => {
    const runtime = initializeRuntime();
    const session = await getSessionById(runtime.paths, request.params.sessionId);

    if (!session) {
      reply.code(404);
      return { error: `Unknown session ${request.params.sessionId}` };
    }

    return {
      sessionId: session.header.sessionId,
      createdAt: session.header.createdAt,
      path: session.path,
      events: session.events,
    };
  });

  return app;
}
