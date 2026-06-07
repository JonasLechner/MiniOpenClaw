type DashboardScreen = "sessions" | "tasks" | "config" | "logs";

type SessionSummary = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
};

type DetachedTask = {
  taskId: string;
  parentSessionId: string;
  detachedSessionId?: string;
  prompt: string;
  status: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
};

type ScheduledTask = {
  id: string;
  chatId: string;
  target: string;
  kind: string;
  prompt: string;
  cron: string;
  enabled: boolean;
  lastRunAt?: string;
};

type LogRecord = {
  timestamp?: string;
  level?: string;
  event?: string;
  [key: string]: unknown;
};

type DashboardRenderInput = {
  activeScreen: DashboardScreen;
  configPath: string;
  sessionsPath: string;
  tasksPath: string;
  logsPath: string;
  currentSessionId?: string;
  sessions?: SessionSummary[];
  detachedTasks?: DetachedTask[];
  scheduledTasks?: ScheduledTask[];
  configRaw?: string;
  logs?: LogRecord[];
  notice?: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatLogTime(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

function shortId(value: string | undefined): string {
  if (!value) return "—";
  return value.slice(0, 8);
}

function navLink(screen: DashboardScreen, activeScreen: DashboardScreen, label: string): string {
  const active = screen === activeScreen ? ' class="active"' : "";
  const href = screen === "sessions" ? "/" : `/${screen}`;
  return `<a href="${href}"${active}>${label}</a>`;
}

function renderSessions(input: DashboardRenderInput): string {
  const sessions = input.sessions ?? [];
  if (sessions.length === 0) return '<div class="empty">No sessions yet.</div>';

  return `<ul class="list">${sessions.map((session) => {
    const current = session.sessionId === input.currentSessionId ? '<span class="badge current">current</span>' : "";
    return `<li class="list-item">
      <div class="row-head">
        <span class="mono">${escapeHtml(session.sessionId)}</span>
        ${current}
      </div>
      <p class="primary">${escapeHtml(session.preview || "(no preview)")}</p>
      <div class="meta">
        <span>${session.messageCount} messages</span>
        <span>created ${escapeHtml(formatDate(session.createdAt))}</span>
        <span>updated ${escapeHtml(formatDate(session.updatedAt))}</span>
      </div>
    </li>`;
  }).join("")}</ul>`;
}

function renderTasks(input: DashboardRenderInput): string {
  const detachedTasks = input.detachedTasks ?? [];
  const scheduledTasks = input.scheduledTasks ?? [];
  const items = [
    ...detachedTasks.map((task) => ({
      title: `detached · ${task.taskId}`,
      status: task.status,
      prompt: task.prompt,
      meta: [
        `session ${shortId(task.parentSessionId)}`,
        task.detachedSessionId ? `detached ${shortId(task.detachedSessionId)}` : undefined,
        `created ${formatDate(task.createdAt)}`,
        task.finishedAt ? `finished ${formatDate(task.finishedAt)}` : task.startedAt ? `started ${formatDate(task.startedAt)}` : undefined,
      ].filter(Boolean) as string[],
    })),
    ...scheduledTasks.map((task) => ({
      title: `scheduled · ${task.id}`,
      status: task.enabled ? "enabled" : "disabled",
      prompt: task.prompt,
      meta: [
        task.kind,
        task.target,
        task.cron,
        `chat ${task.chatId}`,
        task.lastRunAt ? `last run ${formatDate(task.lastRunAt)}` : "never run",
      ],
    })),
  ];

  if (items.length === 0) return '<div class="empty">No background tasks yet.</div>';

  return `<ul class="list">${items.map((task) => `<li class="list-item">
    <div class="row-head">
      <span class="mono">${escapeHtml(task.title)}</span>
      <span class="badge ${escapeHtml(task.status)}">${escapeHtml(task.status)}</span>
    </div>
    <p class="primary">${escapeHtml(task.prompt || "(no prompt)")}</p>
    <div class="meta">${task.meta.map((entry) => `<span>${escapeHtml(entry)}</span>`).join("")}</div>
  </li>`).join("")}</ul>`;
}

function renderConfig(input: DashboardRenderInput): string {
  return `<div class="panel-body pad">
    <textarea id="configEditor" spellcheck="false">${escapeHtml(input.configRaw ?? "")}</textarea>
  </div>
  <div class="panel-footer">
    <button class="button primary" id="saveConfigButton" type="button">Save config</button>
    <button class="button" type="button" onclick="location.reload()">Reload file</button>
    <span class="status" id="configStatus">${escapeHtml(input.notice ?? "Edit config, save, then restart the gateway.")}</span>
  </div>`;
}

function renderLogLine(entry: LogRecord): string {
  const timestamp = entry.timestamp ? `<span class="log-ts">${escapeHtml(formatLogTime(String(entry.timestamp)))}</span>` : "";
  const level = typeof entry.level === "string" ? entry.level : undefined;
  const event = typeof entry.event === "string" ? entry.event : "log";
  const meta = Object.entries(entry)
    .filter(([key, value]) => !["timestamp", "level", "event", "text", "args"].includes(key) && value !== undefined)
    .map(([key, value]) => `<span><span class="log-key">${escapeHtml(key)}</span>=${escapeHtml(typeof value === "string" ? value : JSON.stringify(value))}</span>`)
    .join(" ");
  const body = typeof entry.text === "string"
    ? `\n<span class="log-body">▌ ${escapeHtml(entry.text)}</span>`
    : entry.args && typeof entry.args === "object"
      ? `\n<span class="log-body">▌ ${escapeHtml(JSON.stringify(entry.args, null, 2))}</span>`
      : "";

  return `<span class="log-line"><span class="log-headline">${timestamp}${timestamp ? " " : ""}<span class="log-level ${escapeHtml(level ?? "info")}">${escapeHtml(level ?? "info")}</span> <span class="log-event">${escapeHtml(event)}</span>${meta ? ` ${meta}` : ""}</span>${body}</span>`;
}

function renderLogs(input: DashboardRenderInput): string {
  const logs = [...(input.logs ?? [])]
    .filter((entry) => !(entry.event === "gateway_request_completed" && entry.url === "/logs"))
    .reverse();
  return `<div class="panel-body pad">
    <div class="log-stream" id="logsView">${logs.length === 0 ? '<div class="empty">No logs yet.</div>' : logs.map((entry) => `<div class="log-entry">${renderLogLine(entry)}</div>`).join("")}</div>
  </div>
  <div class="panel-footer">
    <button class="button" type="button" onclick="location.reload()">Reload logs</button>
    <span class="status">${escapeHtml(input.notice ?? `${logs.length} records`)}</span>
  </div>`;
}

function renderContent(input: DashboardRenderInput): { title: string; subtitle: string; body: string } {
  switch (input.activeScreen) {
    case "tasks":
      return {
        title: "Background tasks",
        subtitle: "Detached work and cron-backed jobs.",
        body: `<div class="panel-body">${renderTasks(input)}</div>`,
      };
    case "config":
      return {
        title: "Config",
        subtitle: input.configPath,
        body: renderConfig(input),
      };
    case "logs":
      return {
        title: "Logs",
        subtitle: input.logsPath,
        body: renderLogs(input),
      };
    case "sessions":
    default:
      return {
        title: "Sessions",
        subtitle: "Current and recent conversations.",
        body: `<div class="panel-body">${renderSessions(input)}</div>`,
      };
  }
}

function renderClientScript(input: DashboardRenderInput): string {
  if (input.activeScreen === "logs") {
    return `<script>
      async function restartGateway() {
        const status = document.getElementById('topStatus');
        status.textContent = 'Restart requested…';
        try {
          const response = await fetch('/api/restart', { method: 'POST' });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || 'Restart failed.');
          status.textContent = payload.message;
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : String(error);
        }
      }
      document.getElementById('restartButton')?.addEventListener('click', restartGateway);
      history.scrollRestoration = 'manual';
      requestAnimationFrame(() => {
        window.scrollTo(0, 0);
        document.querySelector('.main')?.scrollTo(0, 0);
        document.getElementById('logsView')?.scrollTo(0, 0);
        requestAnimationFrame(() => {
          window.scrollTo(0, 0);
          document.querySelector('.main')?.scrollTo(0, 0);
          document.getElementById('logsView')?.scrollTo(0, 0);
        });
      });
    </script>`;
  }

  if (input.activeScreen !== "config") {
    return `<script>
      async function restartGateway() {
        const status = document.getElementById('topStatus');
        status.textContent = 'Restart requested…';
        try {
          const response = await fetch('/api/restart', { method: 'POST' });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || 'Restart failed.');
          status.textContent = payload.message;
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : String(error);
        }
      }
      document.getElementById('restartButton')?.addEventListener('click', restartGateway);
    </script>`;
  }

  return `<script>
    async function restartGateway() {
      const topStatus = document.getElementById('topStatus');
      topStatus.textContent = 'Restart requested…';
      try {
        const response = await fetch('/api/restart', { method: 'POST' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Restart failed.');
        topStatus.textContent = payload.message;
      } catch (error) {
        topStatus.textContent = error instanceof Error ? error.message : String(error);
      }
    }

    async function saveConfig() {
      const status = document.getElementById('configStatus');
      const editor = document.getElementById('configEditor');
      status.textContent = 'Saving…';
      try {
        const response = await fetch('/api/config', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ raw: editor.value }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Save failed.');
        status.textContent = payload.message;
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
      }
    }

    document.getElementById('restartButton')?.addEventListener('click', restartGateway);
    document.getElementById('saveConfigButton')?.addEventListener('click', saveConfig);
  </script>`;
}

export function renderDashboardPage(input: DashboardRenderInput): string {
  const content = renderContent(input);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>MiniOpenClaw dashboard</title>
    <style>
      :root {
        --bg: #121416;
        --bg-2: #181b1f;
        --line: #303640;
        --line-2: #414957;
        --text: #ecebe7;
        --muted: #8e96a1;
        --blue: #4f83ff;
        --green: #7bbc7a;
        --red: #da7474;
        --yellow: #d8b35d;
        --sidebar: 236px;
      }
      * { box-sizing: border-box; }
      html, body { height: 100%; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font-family: Georgia, "Iowan Old Style", serif;
      }
      .app {
        height: 100vh;
        display: grid;
        grid-template-columns: var(--sidebar) minmax(0, 1fr);
        overflow: hidden;
      }
      .sidebar {
        height: 100vh;
        position: sticky;
        top: 0;
        overflow: hidden;
        background: #0f1113;
        border-right: 1px solid var(--line);
        padding: 26px 18px 20px;
      }
      .sidebar h1 {
        margin: 0 0 8px;
        font-size: 1.3rem;
        letter-spacing: -0.03em;
      }
      .sidebar p {
        margin: 0 0 24px;
        color: var(--muted);
        line-height: 1.55;
        font-size: 0.92rem;
        max-width: 22ch;
      }
      .nav {
        display: grid;
        gap: 6px;
      }
      .nav a {
        color: var(--muted);
        text-decoration: none;
        border: 1px solid transparent;
        padding: 12px 13px;
        font-size: 0.95rem;
      }
      .nav a.active,
      .nav a:hover {
        color: var(--text);
        border-color: var(--line-2);
        background: #171a1e;
      }
      .main {
        height: 100vh;
        overflow: auto;
        padding: 28px;
      }
      .topbar {
        display: flex;
        justify-content: space-between;
        gap: 18px;
        align-items: flex-start;
        margin-bottom: 22px;
      }
      .eyebrow {
        margin: 0 0 10px;
        color: var(--blue);
        text-transform: uppercase;
        letter-spacing: 0.14em;
        font-size: 0.7rem;
        font-family: "Courier New", monospace;
      }
      .title {
        margin: 0;
        font-size: clamp(2.1rem, 4vw, 3rem);
        line-height: 0.96;
        letter-spacing: -0.06em;
      }
      .subtitle {
        margin: 12px 0 0;
        color: var(--muted);
        max-width: 58ch;
        line-height: 1.5;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }
      .button {
        border: 1px solid var(--line-2);
        background: var(--bg-2);
        color: var(--text);
        padding: 10px 14px;
        cursor: pointer;
        font: inherit;
      }
      .button.primary {
        background: var(--blue);
        border-color: var(--blue);
        color: white;
      }
      .status {
        color: var(--muted);
        font-size: 0.9rem;
      }
      .panel {
        border: 1px solid var(--line);
        background: var(--bg-2);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.02);
      }
      .panel-head {
        padding: 18px 20px;
        border-bottom: 1px solid var(--line);
      }
      .panel-head h2 {
        margin: 0;
        font-size: 1.15rem;
      }
      .panel-head p {
        margin: 8px 0 0;
        color: var(--muted);
        font-size: 0.9rem;
        line-height: 1.5;
      }
      .panel-body.pad { padding: 16px; }
      .panel-footer {
        border-top: 1px solid var(--line);
        padding: 14px 16px;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }
      .list {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .list-item {
        padding: 18px 20px;
        border-bottom: 1px solid var(--line);
      }
      .list-item:last-child { border-bottom: 0; }
      .row-head {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: flex-start;
        margin-bottom: 10px;
      }
      .mono, textarea, pre {
        font-family: "Courier New", monospace;
      }
      .primary {
        margin: 0;
        line-height: 1.5;
        font-size: 1.02rem;
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 14px;
        margin-top: 12px;
        color: var(--muted);
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .badge {
        border: 1px solid var(--line-2);
        padding: 4px 8px;
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        font-family: "Courier New", monospace;
      }
      .badge.current, .badge.running, .badge.enabled { color: var(--blue); }
      .badge.completed { color: var(--green); }
      .badge.failed, .badge.aborted, .badge.disabled { color: var(--red); }
      .badge.queued { color: var(--yellow); }
      .empty {
        padding: 18px 16px;
        color: var(--muted);
      }
      textarea {
        width: 100%;
        min-height: 70vh;
        border: 1px solid var(--line-2);
        background: #111317;
        color: var(--text);
        padding: 14px;
        resize: vertical;
        line-height: 1.5;
        font-size: 0.9rem;
      }
      .log-stream {
        min-height: 70vh;
        color: #dde4ef;
        font-family: "Courier New", monospace;
        font-size: 0.84rem;
      }
      .log-entry {
        margin-bottom: 1em;
        white-space: pre-wrap;
        line-height: 1.45;
      }
      .log-entry:last-child {
        margin-bottom: 0;
      }
      .log-line {
        display: block;
      }
      .log-headline {
        color: #d7dce5;
      }
      .log-ts {
        color: var(--muted);
      }
      .log-level {
        text-transform: lowercase;
      }
      .log-level.info { color: var(--green); }
      .log-level.warn { color: var(--yellow); }
      .log-level.error { color: var(--red); }
      .log-level.debug { color: var(--muted); }
      .log-event {
        color: var(--blue);
      }
      .log-key {
        color: var(--muted);
      }
      .log-body {
        color: #e6ebf5;
      }
      @media (max-width: 900px) {
        .app { height: auto; grid-template-columns: 1fr; overflow: visible; }
        .sidebar { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
        .main { height: auto; overflow: visible; padding: 16px; }
        .topbar { flex-direction: column; }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <aside class="sidebar">
        <h1>Gateway control</h1>
        <p>Sessions, tasks, logs, config, restart.</p>
        <nav class="nav">
          ${navLink("sessions", input.activeScreen, "Sessions")}
          ${navLink("tasks", input.activeScreen, "Background tasks")}
          ${navLink("config", input.activeScreen, "Config")}
          ${navLink("logs", input.activeScreen, "Logs")}
        </nav>
      </aside>
      <main class="main">
        <div class="topbar">
          <div>
            <p class="eyebrow">Local control plane</p>
            <h1 class="title">${escapeHtml(content.title)}</h1>
            <p class="subtitle">${escapeHtml(content.subtitle)}</p>
          </div>
          <div class="toolbar">
            <button class="button" type="button" onclick="location.reload()">Reload screen</button>
            <button class="button primary" id="restartButton" type="button">Restart gateway</button>
            <span class="status" id="topStatus">${escapeHtml(input.notice ?? "")}</span>
          </div>
        </div>
        <section class="panel">
          <div class="panel-head">
            <h2>${escapeHtml(content.title)}</h2>
            <p>${escapeHtml(content.subtitle)}</p>
          </div>
          ${content.body}
        </section>
      </main>
    </div>
    ${renderClientScript(input)}
  </body>
</html>`;
}
