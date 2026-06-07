import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function readTextFileOrEmpty(path: string): Promise<string> {
  return readFile(path, "utf8").catch((error: unknown) => {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return "";
    }
    throw error;
  });
}

export async function appendContextEntryIfMissing(workspacePath: string, content: string): Promise<boolean> {
  const path = join(workspacePath, "context.md");
  const existing = await readTextFileOrEmpty(path);
  const normalized = content.trim();
  const entries = existing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (entries.includes(normalized)) {
    return false;
  }

  const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  await appendFile(path, `${prefix}${normalized}\n`, "utf8");
  return true;
}

export async function readOnboardingFile(workspacePath: string, fileName: "context.md" | "user.md"): Promise<string> {
  return readTextFileOrEmpty(join(workspacePath, fileName));
}

export async function writeOnboardingFile(workspacePath: string, fileName: "context.md" | "user.md", markdown: string): Promise<void> {
  const path = join(workspacePath, fileName);
  const content = markdown.trim();
  await writeFile(path, content ? `${content}\n` : "", "utf8");
}
