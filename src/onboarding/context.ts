import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

export async function appendContextEntryIfMissing(workspacePath: string, content: string): Promise<boolean> {
  const path = join(workspacePath, "context.md");
  const existing = await readFile(path, "utf8").catch((error: unknown) => {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  const normalized = content.trim();
  const entries = existing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (entries.includes(normalized)) {
    return false;
  }

  const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  await appendFile(path, `${prefix}${normalized}\n`, "utf8");
  return true;
}
