import { mkdirSync } from "node:fs";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, join, relative, sep } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import Database from "better-sqlite3";
import { isWithinWorkspacePath } from "./host-workspace.js";
import type { RuntimeState } from "./runtime.js";

export type WorkspaceSearchRecord = {
  path: string;
  content: string;
  modifiedAtMs: number;
  size: number;
  indexedAt: string;
};

export type WorkspaceSearchResult = {
  path: string;
  snippet: string;
  score: number;
};

export interface WorkspaceSearchRepository {
  init(): Promise<void>;
  getByPath(path: string): Promise<WorkspaceSearchRecord | undefined>;
  upsert(input: { path: string; content: string; modifiedAtMs: number; size: number }): Promise<void>;
  deleteByPath(path: string): Promise<void>;
  listPaths(): Promise<Array<Pick<WorkspaceSearchRecord, "path" | "modifiedAtMs" | "size">>>;
  search(query: string, limit?: number): Promise<WorkspaceSearchResult[]>;
  close(): void;
}

export interface WorkspaceSearchIndexer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export type WorkspaceSearchIndexConfig = {
  enabled: boolean;
  include: string[];
};

const WORKSPACE_SEARCH_INDEX_DATABASE_FILENAME = "workspace-search.sqlite";
const MAX_INDEXED_FILE_BYTES = 1024 * 1024;
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".pi",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".cache",
]);
const INDEXED_FILE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".jsonl",
  ".jsx",
  ".log",
  ".md",
  ".mdx",
  ".mjs",
  ".py",
  ".sh",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

type WorkspaceDocumentRow = {
  path: string;
  content: string;
  modified_at_ms: number;
  size: number;
  indexed_at: string;
};

function mapRow(row: WorkspaceDocumentRow | undefined): WorkspaceSearchRecord | undefined {
  if (!row) return undefined;

  return {
    path: row.path,
    content: row.content,
    modifiedAtMs: row.modified_at_ms,
    size: row.size,
    indexedAt: row.indexed_at,
  };
}

function hasIgnoredWorkspaceDirectory(relativePath: string): boolean {
  return relativePath.split("/").some((segment) => IGNORED_DIRECTORY_NAMES.has(segment));
}

function normalizeWorkspacePattern(pattern: string): string {
  return pattern.replace(/^\.\//, "").replace(/\\/g, "/");
}

function workspacePathMatchesPattern(relativePath: string, pattern: string): boolean {
  const normalizedPattern = normalizeWorkspacePattern(pattern);
  if (normalizedPattern === "**") return true;
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
  }
  if (normalizedPattern.endsWith("/*")) {
    const prefix = normalizedPattern.slice(0, -2);
    if (!relativePath.startsWith(`${prefix}/`)) return false;
    return !relativePath.slice(prefix.length + 1).includes("/");
  }
  return relativePath === normalizedPattern;
}

function workspacePathCouldMatchPattern(relativePath: string, pattern: string): boolean {
  const normalizedPattern = normalizeWorkspacePattern(pattern);
  if (normalizedPattern === "**" || workspacePathMatchesPattern(relativePath, normalizedPattern)) return true;
  const firstWildcard = normalizedPattern.search(/[?*]/);
  const staticPrefix = firstWildcard === -1 ? normalizedPattern : normalizedPattern.slice(0, firstWildcard);
  const prefixSegments = staticPrefix.split("/").filter(Boolean);
  const pathSegments = relativePath.split("/").filter(Boolean);
  return prefixSegments.slice(0, pathSegments.length).join("/") === pathSegments.join("/");
}

function isIncludedWorkspacePath(relativePath: string, includePatterns: string[]): boolean {
  return includePatterns.some((pattern) => workspacePathMatchesPattern(relativePath, pattern));
}

function couldContainIncludedWorkspacePath(relativePath: string, includePatterns: string[]): boolean {
  return includePatterns.some((pattern) => workspacePathCouldMatchPattern(relativePath, pattern));
}

function shouldIgnoreWorkspacePath(relativePath: string): boolean {
  if (relativePath === WORKSPACE_SEARCH_INDEX_DATABASE_FILENAME || relativePath.endsWith(".sqlite") || relativePath.endsWith(".sqlite-shm") || relativePath.endsWith(".sqlite-wal")) {
    return true;
  }

  if (hasIgnoredWorkspaceDirectory(relativePath)) {
    return true;
  }

  const extension = extname(relativePath).toLowerCase();
  return !INDEXED_FILE_EXTENSIONS.has(extension);
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isProbablyText(buffer: Buffer): boolean {
  if (buffer.includes(0)) {
    return false;
  }

  return true;
}

function buildFtsQuery(query: string): string {
  const terms = query.match(/[\p{L}\p{N}_./-]+/gu) ?? [];
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(" ");
}

async function collectWorkspaceFiles(workspaceRoot: string, includePatterns: string[]): Promise<string[]> {
  const files: string[] = [];
  const pending = [workspaceRoot];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;

    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(current, entry.name);
      const stats = await lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        continue;
      }
      const relativePath = relative(workspaceRoot, absolutePath).split(sep).join("/");
      if (stats.isDirectory()) {
        if (!hasIgnoredWorkspaceDirectory(relativePath) && couldContainIncludedWorkspacePath(relativePath, includePatterns)) {
          pending.push(absolutePath);
        }
        continue;
      }
      if (!isIncludedWorkspacePath(relativePath, includePatterns) || shouldIgnoreWorkspacePath(relativePath)) {
        continue;
      }
      if (stats.isFile()) {
        files.push(absolutePath);
      }
    }
  }

  return files;
}

async function indexWorkspacePath(
  repository: WorkspaceSearchRepository,
  workspaceRoot: string,
  absolutePath: string,
): Promise<void> {
  let canonicalWorkspaceRoot: string;
  let canonicalPath: string;

  try {
    canonicalWorkspaceRoot = await realpath(workspaceRoot);
    canonicalPath = await realpath(absolutePath);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }

    const relativePath = relative(workspaceRoot, absolutePath).split(sep).join("/");
    if (relativePath && !relativePath.startsWith("../")) {
      await repository.deleteByPath(relativePath);
    }
    return;
  }

  if (!isWithinWorkspacePath(canonicalWorkspaceRoot, canonicalPath)) {
    throw new Error(`workspace search path must stay within workspace: ${canonicalWorkspaceRoot}`);
  }

  const relativePath = relative(workspaceRoot, absolutePath).split(sep).join("/");
  if (shouldIgnoreWorkspacePath(relativePath)) {
    return;
  }

  let fileStats;
  try {
    fileStats = await stat(canonicalPath);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
    await repository.deleteByPath(relativePath);
    return;
  }

  if (!fileStats.isFile()) {
    await repository.deleteByPath(relativePath);
    return;
  }

  const existing = await repository.getByPath(relativePath);
  const modifiedAtMs = fileStats.mtimeMs;
  const size = fileStats.size;
  if (size > MAX_INDEXED_FILE_BYTES) {
    await repository.deleteByPath(relativePath);
    return;
  }
  if (existing && existing.modifiedAtMs === modifiedAtMs && existing.size === size) {
    return;
  }

  const buffer = await readFile(canonicalPath);
  if (!isProbablyText(buffer)) {
    await repository.deleteByPath(relativePath);
    return;
  }

  await repository.upsert({
    path: relativePath,
    content: buffer.toString("utf8"),
    modifiedAtMs,
    size,
  });
}

async function deleteWorkspacePath(
  repository: WorkspaceSearchRepository,
  workspaceRoot: string,
  absolutePath: string,
): Promise<void> {
  const relativePath = relative(workspaceRoot, absolutePath).split(sep).join("/");
  if (!relativePath || relativePath.startsWith("../") || shouldIgnoreWorkspacePath(relativePath)) {
    return;
  }

  await repository.deleteByPath(relativePath);
}

export function getWorkspaceSearchDatabasePath(runtime: RuntimeState): string {
  return join(runtime.paths.workspace, WORKSPACE_SEARCH_INDEX_DATABASE_FILENAME);
}

export async function syncWorkspaceSearchIndex(repository: WorkspaceSearchRepository, workspaceRoot: string, includePatterns = ["**"]): Promise<void> {
  const canonicalWorkspaceRoot = await realpath(workspaceRoot);
  const seenPaths = new Set<string>();

  for (const absolutePath of await collectWorkspaceFiles(workspaceRoot, includePatterns)) {
    const canonicalPath = await realpath(absolutePath);
    if (!isWithinWorkspacePath(canonicalWorkspaceRoot, canonicalPath)) {
      throw new Error(`workspace search path must stay within workspace: ${canonicalWorkspaceRoot}`);
    }

    const relativePath = relative(workspaceRoot, absolutePath).split(sep).join("/");
    if (shouldIgnoreWorkspacePath(relativePath)) {
      continue;
    }

    seenPaths.add(relativePath);
    await indexWorkspacePath(repository, workspaceRoot, absolutePath);
  }

  for (const row of await repository.listPaths()) {
    if (!seenPaths.has(row.path)) {
      await repository.deleteByPath(row.path);
    }
  }
}

export async function refreshWorkspaceSearchIndexForWorkspace(workspaceRoot: string, includePatterns = ["**"]): Promise<void> {
  const repository = createSqliteWorkspaceSearchRepository(join(workspaceRoot, WORKSPACE_SEARCH_INDEX_DATABASE_FILENAME));

  try {
    await syncWorkspaceSearchIndex(repository, workspaceRoot, includePatterns);
  } finally {
    repository.close();
  }
}

export async function refreshWorkspaceSearchIndex(runtime: RuntimeState): Promise<void> {
  await refreshWorkspaceSearchIndexForWorkspace(runtime.paths.workspace, runtime.config.workspaceSearch?.include);
}

export function createWorkspaceSearchIndexerForWorkspace(workspaceRoot: string, config: WorkspaceSearchIndexConfig = { enabled: true, include: ["**"] }): WorkspaceSearchIndexer {
  let repository: WorkspaceSearchRepository | undefined;
  let watcher: FSWatcher | undefined;
  let started = false;

  const failIndexer = (error: unknown): void => {
    started = false;
    void watcher?.close();
    watcher = undefined;
    repository?.close();
    repository = undefined;
    queueMicrotask(() => {
      throw toError(error);
    });
  };

  return {
    async start(): Promise<void> {
      if (started || !config.enabled) return;
      const databasePath = join(workspaceRoot, WORKSPACE_SEARCH_INDEX_DATABASE_FILENAME);
      repository = createSqliteWorkspaceSearchRepository(databasePath);
      try {
        await repository.init();
        await syncWorkspaceSearchIndex(repository, workspaceRoot, config.include);
      } catch (error) {
        repository.close();
        repository = undefined;
        throw error;
      }

      watcher = chokidar.watch(workspaceRoot, {
        ignored: (path, stats) => {
          const relativePath = relative(workspaceRoot, path).split(sep).join("/");
          if (!relativePath || relativePath.startsWith("../")) {
            return false;
          }
          if (stats?.isSymbolicLink()) {
            return true;
          }
          if (stats?.isDirectory()) {
            return hasIgnoredWorkspaceDirectory(relativePath) || !couldContainIncludedWorkspacePath(relativePath, config.include);
          }
          if (!stats) {
            return hasIgnoredWorkspaceDirectory(relativePath) || relativePath === WORKSPACE_SEARCH_INDEX_DATABASE_FILENAME || relativePath.endsWith(".sqlite") || relativePath.endsWith(".sqlite-shm") || relativePath.endsWith(".sqlite-wal");
          }
          return !isIncludedWorkspacePath(relativePath, config.include) || shouldIgnoreWorkspacePath(relativePath);
        },
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 25,
        },
      });

      const update = (path: string) => {
        if (!repository) return;
        void indexWorkspacePath(repository, workspaceRoot, path).catch(failIndexer);
      };
      const remove = (path: string) => {
        if (!repository) return;
        void deleteWorkspacePath(repository, workspaceRoot, path).catch(failIndexer);
      };

      watcher.on("add", update);
      watcher.on("change", update);
      watcher.on("unlink", remove);
      watcher.on("unlinkDir", remove);
      await new Promise<void>((resolve) => watcher?.once("ready", () => resolve()));
      started = true;
    },

    async stop(): Promise<void> {
      started = false;
      await watcher?.close();
      watcher = undefined;
      repository?.close();
      repository = undefined;
    },
  };
}

export function createWorkspaceSearchIndexer(runtime: RuntimeState): WorkspaceSearchIndexer {
  return createWorkspaceSearchIndexerForWorkspace(runtime.paths.workspace, runtime.config.workspaceSearch);
}

export function createSqliteWorkspaceSearchRepository(databasePath: string): WorkspaceSearchRepository {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);

  const init = () => {
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_files (
        path TEXT PRIMARY KEY,
        modified_at_ms REAL NOT NULL,
        size INTEGER NOT NULL,
        indexed_at TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS workspace_documents_fts USING fts5(
        path UNINDEXED,
        content,
        tokenize='unicode61'
      );
    `);
  };

  return {
    async init(): Promise<void> {
      init();
    },

    async getByPath(path: string): Promise<WorkspaceSearchRecord | undefined> {
      init();
      const row = db.prepare(`
        SELECT f.path, d.content, f.modified_at_ms, f.size, f.indexed_at
        FROM workspace_files f
        LEFT JOIN workspace_documents_fts d ON d.path = f.path
        WHERE f.path = ?
      `).get(path) as WorkspaceDocumentRow | undefined;

      return mapRow(row);
    },

    async upsert(input): Promise<void> {
      init();
      const indexedAt = new Date().toISOString();
      db.transaction(() => {
        db.prepare(`
          INSERT INTO workspace_files (path, modified_at_ms, size, indexed_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(path) DO UPDATE SET
            modified_at_ms = excluded.modified_at_ms,
            size = excluded.size,
            indexed_at = excluded.indexed_at
        `).run(input.path, input.modifiedAtMs, input.size, indexedAt);

        db.prepare(`DELETE FROM workspace_documents_fts WHERE path = ?`).run(input.path);
        db.prepare(`INSERT INTO workspace_documents_fts (path, content) VALUES (?, ?)`).run(input.path, input.content);
      })();
    },

    async deleteByPath(path: string): Promise<void> {
      init();
      db.transaction(() => {
        db.prepare(`DELETE FROM workspace_files WHERE path = ?`).run(path);
        db.prepare(`DELETE FROM workspace_documents_fts WHERE path = ?`).run(path);
      })();
    },

    async listPaths(): Promise<Array<Pick<WorkspaceSearchRecord, "path" | "modifiedAtMs" | "size">>> {
      init();
      return (db.prepare(`
        SELECT path, modified_at_ms, size
        FROM workspace_files
      `).all() as Array<{ path: string; modified_at_ms: number; size: number }>).map((row) => ({
        path: row.path,
        modifiedAtMs: row.modified_at_ms,
        size: row.size,
      }));
    },

    async search(query: string, limit = 5): Promise<WorkspaceSearchResult[]> {
      init();
      const ftsQuery = buildFtsQuery(query);
      if (!ftsQuery) {
        return [];
      }

      return db.prepare(`
        SELECT
          path,
          snippet(workspace_documents_fts, 1, '**', '**', ' … ', 40) AS snippet,
          bm25(workspace_documents_fts) AS score
        FROM workspace_documents_fts
        WHERE workspace_documents_fts MATCH ?
        ORDER BY score
        LIMIT ?
      `).all(ftsQuery, Math.max(1, Math.floor(limit))) as WorkspaceSearchResult[];
    },

    close(): void {
      db.close();
    },
  };
}
