import Fastify, { type FastifyInstance } from "fastify";
import { readFile, writeFile } from "node:fs/promises";
import type { RuntimeState } from "../core/runtime.js";
import { ensureCurrentSession, listSessions } from "../core/sessions.js";
import { createMainSessionAgent } from "./agent-runner.js";
import { logGatewayError, logGatewayRequest, logWorkspaceSearchIndexerFailed, logWorkspaceSearchIndexerStarted, markGatewayRequestStart } from "./log.js";
import { createGatewayScheduler } from "../jobs/scheduler.js";
import { createWorkspaceSearchIndexer } from "../core/workspace-search-index.js";
import { buildTelegramGatewayApp } from "../transports/telegram/app.js";
import { renderDashboardPage } from "./dashboard.js";
import { listScheduledTasks } from "../jobs/task-store.js";
import { getGatewayServicePaths } from "./service.js";

async function readTextOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function readRecentLogs(path: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readTextOrEmpty(path);
  const lines = raw.trim().split("\n").filter(Boolean).slice(-200);
  const parsed: Array<Record<string, unknown>> = [];

  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      parsed.push({ message: line });
    }
  }

  return parsed;
}

async function renderDashboard(runtime: RuntimeState, activeScreen: "sessions" | "tasks" | "config" | "logs", notice?: string): Promise<string> {
  const servicePaths = getGatewayServicePaths(runtime);
  const currentSession = await ensureCurrentSession(runtime.paths, "gateway");
  return renderDashboardPage({
    activeScreen,
    configPath: runtime.paths.configFile,
    sessionsPath: runtime.paths.sessions,
    tasksPath: runtime.paths.scheduledTasks,
    logsPath: servicePaths.stdoutLog,
    currentSessionId: currentSession.sessionId,
    sessions: activeScreen === "sessions" ? await listSessions(runtime.paths) : undefined,
    scheduledTasks: activeScreen === "tasks" ? await listScheduledTasks(runtime.paths) : undefined,
    detachedTasks: [],
    configRaw: activeScreen === "config" ? await readTextOrEmpty(runtime.paths.configFile) : undefined,
    logs: activeScreen === "logs" ? await readRecentLogs(servicePaths.stdoutLog) : undefined,
    notice,
  });
}

export function buildGateway(runtime: RuntimeState): FastifyInstance {
  const app = Fastify({ logger: false });
  const mainSessionAgent = createMainSessionAgent(runtime);
  const telegramApp = buildTelegramGatewayApp(runtime, mainSessionAgent);
  const scheduler = createGatewayScheduler(runtime, telegramApp?.streamer, mainSessionAgent);
  const workspaceSearchIndexer = createWorkspaceSearchIndexer(runtime);

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
    void workspaceSearchIndexer.start()
      .then(logWorkspaceSearchIndexerStarted)
      .catch((error: unknown) => logWorkspaceSearchIndexerFailed(error instanceof Error ? error : new Error(String(error))));
  });

  app.addHook("onClose", async () => {
    scheduler.stop();
    await telegramApp?.stop();
    await workspaceSearchIndexer.stop();
  });

  app.get("/", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return renderDashboard(runtime, "sessions");
  });

  app.get("/tasks", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return renderDashboard(runtime, "tasks");
  });

  app.get("/config", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return renderDashboard(runtime, "config");
  });

  app.get("/logs", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return renderDashboard(runtime, "logs");
  });

  app.post("/api/restart", async (_request, reply) => {
    reply.code(501);
    return { error: "Gateway restart is not available from the in-process dashboard yet." };
  });

  app.put<{ Body: { raw?: unknown } }>("/api/config", async (request, reply) => {
    if (typeof request.body?.raw !== "string") {
      reply.code(400);
      return { error: "Expected JSON body with string field raw." };
    }

    try {
      const parsed = JSON.parse(request.body.raw) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        reply.code(400);
        return { error: "Config must be a JSON object." };
      }
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : String(error) };
    }

    await writeFile(runtime.paths.configFile, `${request.body.raw.trimEnd()}\n`, "utf8");
    return { message: `Saved ${runtime.paths.configFile}. Restart the gateway to apply changes.` };
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/sessions", async () => {
    return { sessions: await listSessions(runtime.paths) };
  });


  return app;
}
