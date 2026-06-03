import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { createSqliteDailySummaryRepository, syncDailySummaryMarkdownFiles } from "../../core/daily-summary-repository.js";
import { requireToolContext, textToolResult, type ToolDefinition, type ToolRunResult } from "./types.js";

export interface DailySummarySearchInput {
  query: string;
  k?: number;
}

export interface DailySummarySearchDetails {
  paths: string[];
}

export const dailySummarySearchTool: ToolDefinition<DailySummarySearchInput, ToolRunResult<DailySummarySearchDetails>> = {
  name: "daily_summary_search",
  description: "Search daily summaries with BM25 ranking and return only the paths of the best k matches.",
  parameters: Type.Object({
    query: Type.String(),
    k: Type.Optional(Type.Number()),
  }),
  async run(input, context) {
    const toolContext = requireToolContext(context);
    const workspaceRoot = await toolContext.workspace.resolvePath(".");
    const repository = createSqliteDailySummaryRepository(join(workspaceRoot, "daily-summaries.sqlite"));

    try {
      const limit = Math.max(1, Math.floor(input.k ?? 5));
      await syncDailySummaryMarkdownFiles(repository, join(workspaceRoot, "memory"));
      const paths = await repository.searchPaths(input.query, limit);
      return textToolResult(paths.join("\n"), { paths });
    } finally {
      repository.close();
    }
  },
};
