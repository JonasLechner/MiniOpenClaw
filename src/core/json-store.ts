import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const LOCK_POLL_INTERVAL_MS = 20;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

export async function withFileLock<T>(path: string, task: () => Promise<T>, timeoutMs = DEFAULT_LOCK_TIMEOUT_MS): Promise<T> {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "EEXIST") {
        throw error;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out acquiring lock for ${path}`, { cause: error });
      }
      await delay(LOCK_POLL_INTERVAL_MS);
    }
  }

  try {
    return await task();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

export async function updateJsonFile<T>(path: string, fallback: T, updater: (current: T) => T | Promise<T>): Promise<T> {
  return withFileLock(path, async () => {
    const current = await readJsonFile(path, fallback);
    const next = await updater(current);
    await writeJsonFile(path, next);
    return next;
  });
}
