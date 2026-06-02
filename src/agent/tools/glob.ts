import { Type } from "@earendil-works/pi-ai";
import { join, relative } from "path";
import type { Workspace } from "../../core/workspace.js";
import { resolveWorkspacePath } from "./fs.js";
import { requireToolContext, textToolResult, type ToolDefinition, type ToolRunResult } from "./types.js";
import { truncateHead, truncationNotice, type TruncationDetails } from "./truncate.js";

export interface GlobInput {
  path: string;
  pattern: string;
  caseSensitive?: boolean;
  includeDirectories?: boolean;
}

export interface GlobOutput {
  path: string;
  matches: string[];
  truncation?: TruncationDetails;
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
  workspace: Workspace,
  rootPath: string,
  currentPath: string,
  includeDirectories: boolean,
  entries: string[],
): Promise<void> {
  const directoryEntries = await workspace.readDir(currentPath);

  for (const entry of directoryEntries) {
    const entryPath = join(currentPath, entry.name);
    const relativePath = relative(rootPath, entryPath).replace(/\\/g, "/");

    if (entry.isDirectory) {
      if (includeDirectories) {
        entries.push(relativePath);
      }
      await collectEntries(workspace, rootPath, entryPath, includeDirectories, entries);
      continue;
    }

    if (entry.isFile) {
      entries.push(relativePath);
    }
  }
}

export const globTool: ToolDefinition<GlobInput, ToolRunResult<GlobOutput>> = {
  name: "glob",
  description: "Find files matching a glob pattern under a workspace directory.",
  parameters: Type.Object({
    path: Type.String(),
    pattern: Type.String(),
    caseSensitive: Type.Optional(Type.Boolean()),
    includeDirectories: Type.Optional(Type.Boolean()),
  }),
  async run(input: GlobInput, context) {
    const toolContext = requireToolContext(context);
    const path = await resolveWorkspacePath(input.path, toolContext);
    const matcher = globToRegex(input.pattern, input.caseSensitive ?? true);
    const entries: string[] = [];

    await collectEntries(toolContext.workspace, path, path, input.includeDirectories ?? false, entries);

    const matches = entries.filter((entry) => matcher.test(entry)).sort();
    const output = matches.length === 0 ? "No matches." : matches.join("\n");
    const truncated = truncateHead(output);

    return textToolResult(`${truncated.content}${truncationNotice(truncated.details)}`, {
      path,
      matches,
      truncation: truncated.details.truncated ? truncated.details : undefined,
    });
  },
};
