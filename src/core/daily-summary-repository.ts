import { mkdirSync } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import Database from "better-sqlite3";

export type DailySummaryRecord = {
  day: string;
  content: string;
  path: string;
  createdAt: string;
  updatedAt: string;
};

export type UpsertDailySummaryInput = {
  day: string;
  content: string;
  path: string;
};

export interface DailySummaryRepository {
  init(): Promise<void>;
  getByDay(day: string): Promise<DailySummaryRecord | undefined>;
  upsert(input: UpsertDailySummaryInput): Promise<DailySummaryRecord>;
  deleteByDay(day: string): Promise<void>;
  listRecent(limit?: number): Promise<DailySummaryRecord[]>;
  searchPaths(query: string, limit?: number): Promise<string[]>;
  close(): void;
}

type DailySummaryRow = {
  day: string;
  content: string;
  path: string;
  created_at: string;
  updated_at: string;
};

function tokenize(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function scoreBm25(query: string, documents: Array<{ path: string; content: string }>): string[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const docTerms = documents.map((document) => ({
    path: document.path,
    terms: tokenize(document.content),
  }));
  const averageLength = docTerms.reduce((sum, document) => sum + document.terms.length, 0) / Math.max(1, docTerms.length);
  const k1 = 1.5;
  const b = 0.75;

  const scored = docTerms.map((document) => {
    const frequencies = new Map<string, number>();
    for (const term of document.terms) {
      frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    }

    let score = 0;
    for (const term of queryTerms) {
      const tf = frequencies.get(term) ?? 0;
      if (tf === 0) continue;
      const docsWithTerm = docTerms.filter((entry) => entry.terms.includes(term)).length;
      const idf = Math.log(1 + ((docTerms.length - docsWithTerm + 0.5) / (docsWithTerm + 0.5)));
      const denominator = tf + k1 * (1 - b + b * (document.terms.length / Math.max(1, averageLength)));
      score += idf * ((tf * (k1 + 1)) / denominator);
    }

    return { path: document.path, score };
  });

  return scored
    .filter((document) => document.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((document) => document.path);
}

function mapRow(row: DailySummaryRow | undefined): DailySummaryRecord | undefined {
  if (!row) return undefined;

  return {
    day: row.day,
    content: row.content,
    path: row.path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isWithinRoot(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(rootPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath));
}

export async function syncDailySummaryMarkdownFiles(
  repository: DailySummaryRepository,
  memoryRoot: string,
): Promise<void> {
  let names: string[];

  try {
    names = await readdir(memoryRoot);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return;
    }
    throw error;
  }

  const canonicalMemoryRoot = await realpath(memoryRoot);
  const seenDays = new Set<string>();

  for (const name of names) {
    if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) continue;

    const day = basename(name, ".md");
    seenDays.add(day);
    const existing = await repository.getByDay(day);
    const absolutePath = join(memoryRoot, name);
    const canonicalPath = await realpath(absolutePath);
    if (!isWithinRoot(canonicalMemoryRoot, canonicalPath)) {
      throw new Error(`daily summary path must stay within workspace memory: ${canonicalMemoryRoot}`);
    }

    const fileStats = await stat(canonicalPath);
    if (!fileStats.isFile()) {
      continue;
    }

    const content = await readFile(canonicalPath, "utf8");
    if (existing?.path === `memory/${name}` && existing.content === content) {
      continue;
    }

    await repository.upsert({
      day,
      content,
      path: `memory/${name}`,
    });
  }

  const existingRows = await repository.listRecent(Number.MAX_SAFE_INTEGER);
  for (const row of existingRows) {
    if (!seenDays.has(row.day)) {
      await repository.deleteByDay(row.day);
    }
  }
}

export function createSqliteDailySummaryRepository(databasePath: string): DailySummaryRepository {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);

  const init = () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS daily_summaries (
        day TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  };

  return {
    async init(): Promise<void> {
      init();
    },

    async getByDay(day: string): Promise<DailySummaryRecord | undefined> {
      init();
      const row = db.prepare(`
        SELECT day, content, path, created_at, updated_at
        FROM daily_summaries
        WHERE day = ?
      `).get(day) as DailySummaryRow | undefined;

      return mapRow(row);
    },

    async upsert(input: UpsertDailySummaryInput): Promise<DailySummaryRecord> {
      init();
      const existing = await this.getByDay(input.day);
      const now = new Date().toISOString();
      const createdAt = existing?.createdAt ?? now;

      db.prepare(`
        INSERT INTO daily_summaries (day, content, path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(day) DO UPDATE SET
          content = excluded.content,
          path = excluded.path,
          updated_at = excluded.updated_at
      `).run(input.day, input.content, input.path, createdAt, now);

      return {
        day: input.day,
        content: input.content,
        path: input.path,
        createdAt,
        updatedAt: now,
      };
    },

    async deleteByDay(day: string): Promise<void> {
      init();
      db.prepare(`
        DELETE FROM daily_summaries
        WHERE day = ?
      `).run(day);
    },

    async listRecent(limit = 30): Promise<DailySummaryRecord[]> {
      init();
      const rows = db.prepare(`
        SELECT day, content, path, created_at, updated_at
        FROM daily_summaries
        ORDER BY day DESC
        LIMIT ?
      `).all(limit) as DailySummaryRow[];

      return rows.map((row) => mapRow(row)).filter((row): row is DailySummaryRecord => row !== undefined);
    },

    async searchPaths(query: string, limit = 5): Promise<string[]> {
      init();
      const rows = db.prepare(`
        SELECT path, content
        FROM daily_summaries
      `).all() as Array<{ path: string; content: string }>;

      return scoreBm25(query, rows).slice(0, limit);
    },

    close(): void {
      db.close();
    },
  };
}
