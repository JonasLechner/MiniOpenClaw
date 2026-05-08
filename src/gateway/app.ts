import Fastify, { type FastifyInstance } from "fastify";

export function buildGateway(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
