import { promises as fs } from "fs";
import { join, relative } from "path";
import { resolveWorkspacePath } from "./fs.js";
import type { Tool } from "./types.js";

export interface GlobInput {
  path: string;
  pattern: string;
  caseSensitive?: boolean;
  includeDirectories?: boolean;
}

export interface GlobOutput {
  path: string;
  matches: string[];
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegex(pattern: string, caseSensitive: boolean): RegExp {
  const normalized = pattern.replace(/\\/g, "/");
  let regex = "^";

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (char === "/" && next === "*" && normalized[i + 2] === "*" && normalized[i + 3] === undefined) {
      regex += "(?:/.*)?";
      i += 2;
      continue;
    }

    if (char === "*" && next === "*") {
      const afterNext = normalized[i + 2];
      if (afterNext === "/") {
        regex += "(?:.*/)?";
        i += 2;
      } else {
        regex += ".*";
        i += 1;
      }
      continue;
    }

    if (char === "*") {
      regex += "[^/]*";
      continue;
    }

    if (char === "?") {
      regex += "[^/]";
      continue;
    }

    regex += escapeRegex(char);
  }

  regex += "$";
  return new RegExp(regex, caseSensitive ? "" : "i");
}

async function collectEntries(
  rootPath: string,
  currentPath: string,
  includeDirectories: boolean,
  entries: string[],
): Promise<void> {
  const directoryEntries = await fs.readdir(currentPath, { withFileTypes: true });

  for (const entry of directoryEntries) {
    const entryPath = join(currentPath, entry.name);
    const relativePath = relative(rootPath, entryPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      if (includeDirectories) {
        entries.push(relativePath);
      }
      await collectEntries(rootPath, entryPath, includeDirectories, entries);
      continue;
    }

    if (entry.isFile()) {
      entries.push(relativePath);
    }
  }
}

export const globTool: Tool<GlobInput, GlobOutput> = {
  name: "glob",
  async run(input: GlobInput, context) {
    const path = await resolveWorkspacePath(input.path, context);
    const matcher = globToRegex(input.pattern, input.caseSensitive ?? true);
    const entries: string[] = [];

    await collectEntries(path, path, input.includeDirectories ?? false, entries);

    return {
      path,
      matches: entries.filter((entry) => matcher.test(entry)).sort(),
    };
  },
};
