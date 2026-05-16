import { promises as fs } from "fs";
import { resolveWorkspacePath } from "./fs.js";
import type { Tool } from "./types.js";

export interface GrepInput {
  path: string;
  pattern: string;
  startLine?: number;
  endLine?: number;
  caseSensitive?: boolean;
  useRegex?: boolean;
}

export interface GrepMatch {
  lineNumber: number;
  line: string;
}

export interface GrepOutput {
  path: string;
  matches: GrepMatch[];
}

function createMatcher(input: GrepInput): (line: string) => boolean {
  if (input.useRegex) {
    const flags = input.caseSensitive === false ? "i" : "";
    const regex = new RegExp(input.pattern, flags);
    return (line: string) => regex.test(line);
  }

  const needle = input.caseSensitive === false
    ? input.pattern.toLowerCase()
    : input.pattern;

  return (line: string) => {
    const haystack = input.caseSensitive === false ? line.toLowerCase() : line;
    return haystack.includes(needle);
  };
}

export const grepTool: Tool<GrepInput, GrepOutput> = {
  name: "grep",
  async run(input: GrepInput, context) {
    if (input.startLine !== undefined && input.startLine < 1) {
      throw new Error("startLine must be greater than 0");
    }

    if (input.endLine !== undefined && input.endLine < 1) {
      throw new Error("endLine must be greater than 0");
    }

    if (
      input.startLine !== undefined
      && input.endLine !== undefined
      && input.startLine > input.endLine
    ) {
      throw new Error("startLine must be less than or equal to endLine");
    }

    const path = await resolveWorkspacePath(input.path, context);
    const content = await fs.readFile(path, "utf8");
    const lines = content.split(/\r?\n/);

    if (/\r?\n$/.test(content)) {
      lines.pop();
    }

    const startLine = input.startLine ?? 1;
    const endLine = input.endLine ?? lines.length;
    const matcher = createMatcher(input);
    const matches: GrepMatch[] = [];

    for (let lineNumber = startLine; lineNumber <= endLine && lineNumber <= lines.length; lineNumber += 1) {
      const line = lines[lineNumber - 1];
      if (matcher(line)) {
        matches.push({ lineNumber, line });
      }
    }

    return {
      path,
      matches,
    };
  },
};
