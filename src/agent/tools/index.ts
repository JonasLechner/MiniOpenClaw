import { Type, type Tool as PiTool } from "@earendil-works/pi-ai";
import { editTool } from "./edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { readTool } from "./read.js";
import { webFetchTool } from "./webfetch.js";
import { webSearchTool } from "./websearch.js";
import { writeTool } from "./write.js";

export const exposedTools: PiTool[] = [
  {
    name: "read",
    description: "Read a file, optionally by line range.",
    parameters: Type.Object({
      path: Type.String(),
      startLine: Type.Optional(Type.Number()),
      endLine: Type.Optional(Type.Number()),
    }),
  },
  {
    name: "write",
    description: "Write text to a file.",
    parameters: Type.Object({
      path: Type.String(),
      content: Type.String(),
    }),
  },
  {
    name: "edit",
    description: "Replace a line range in a file.",
    parameters: Type.Object({
      path: Type.String(),
      startLine: Type.Number(),
      endLine: Type.Number(),
      newText: Type.String(),
    }),
  },
  {
    name: "grep",
    description: "Search lines in a file.",
    parameters: Type.Object({
      path: Type.String(),
      pattern: Type.String(),
      startLine: Type.Optional(Type.Number()),
      endLine: Type.Optional(Type.Number()),
      caseSensitive: Type.Optional(Type.Boolean()),
      useRegex: Type.Optional(Type.Boolean()),
    }),
  },
  {
    name: "glob",
    description: "Find files matching a glob pattern under a directory.",
    parameters: Type.Object({
      path: Type.String(),
      pattern: Type.String(),
      caseSensitive: Type.Optional(Type.Boolean()),
      includeDirectories: Type.Optional(Type.Boolean()),
    }),
  },
  {
    name: "websearch",
    description: "Search the web for a query and return result summaries.",
    parameters: Type.Object({
      query: Type.String(),
      limit: Type.Optional(Type.Number()),
    }),
  },
  {
    name: "webfetch",
    description: "Fetch a web page and return either extracted text or raw HTML.",
    parameters: Type.Object({
      url: Type.String(),
      format: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("html") ])),
    }),
  },
];

export const toolMap = {
  read: readTool,
  write: writeTool,
  edit: editTool,
  grep: grepTool,
  glob: globTool,
  websearch: webSearchTool,
  webfetch: webFetchTool,
} as const;
