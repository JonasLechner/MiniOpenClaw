import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { createSqliteWorkspaceSearchRepository, refreshWorkspaceSearchIndexForWorkspace } from "../../core/workspace-search-index.js";
import { requireToolContext, textToolResult, type ToolDefinition, type ToolRunResult } from "./types.js";

export interface WorkspaceSearchInput {
  query: string;
  k?: number;
  forceRefresh?: boolean;
}

export interface WorkspaceSearchDetails {
  matches: Array<{
    path: string;
    snippet: string;
    score: number;
  }>;
}

export const workspaceSearchTool: ToolDefinition<WorkspaceSearchInput, ToolRunResult<WorkspaceSearchDetails>> = {
  name: "workspace_search",
  description: "Document search for indexed text/JSON files in the workspace using SQLite FTS5 BM25 ranking. For code or other file types, use other file tools instead.",
  parameters: Type.Object({
    query: Type.String(),
    k: Type.Optional(Type.Number()),
    forceRefresh: Type.Optional(Type.Boolean()),
  }),
  async run(input, context) {
    const toolContext = requireToolContext(context);
    const workspaceRoot = await toolContext.workspace.resolvePath(".");
    if (input.forceRefresh) {
      await refreshWorkspaceSearchIndexForWorkspace(workspaceRoot);
    }
    const repository = createSqliteWorkspaceSearchRepository(join(workspaceRoot, "workspace-search.sqlite"));

    try {
      const limit = Math.max(1, Math.floor(input.k ?? 5));
      const matches = await repository.search(input.query, limit);
      const text = matches.map((match) => `${match.path}\n${match.snippet}`).join("\n\n");
      return textToolResult(text, { matches });
    } finally {
      repository.close();
    }
  },
};
