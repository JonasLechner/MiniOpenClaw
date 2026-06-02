import { Type } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "./types.js";

export interface WebSearchInput {
  query: string;
  limit?: number;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOutput {
  query: string;
  results: WebSearchResult[];
}

const DUCKDUCKGO_HTML_URL = "https://html.duckduckgo.com/html/";

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x27;/g, "'")
    .replace(/&#x60;/g, "`")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
}

function parseResults(html: string, limit: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const resultRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>|<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>)([\s\S]*?)(?:<\/a>|<\/div>)/g;

  let match: RegExpExecArray | null;
  while ((match = resultRegex.exec(html)) !== null && results.length < limit) {
    const [, url, titleHtml, snippetHtml] = match;
    results.push({
      title: stripTags(titleHtml),
      url: decodeHtml(url),
      snippet: stripTags(snippetHtml),
    });
  }

  return results;
}

export const webSearchTool: ToolDefinition<WebSearchInput, WebSearchOutput> = {
  name: "websearch",
  description: "Search the web for a query and return result summaries.",
  parameters: Type.Object({
    query: Type.String(),
    limit: Type.Optional(Type.Number()),
  }),
  async run(input: WebSearchInput, context) {
    const query = input.query.trim();
    if (!query) {
      throw new Error("query must not be empty");
    }

    const limit = input.limit ?? 5;
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("limit must be a positive integer");
    }

    const url = new URL(DUCKDUCKGO_HTML_URL);
    url.searchParams.set("q", query);

    const response = await fetch(url, {
      headers: {
        "user-agent": "MiniOpenClaw/1.0",
      },
      signal: context?.signal,
    });

    if (!response.ok) {
      throw new Error(`web search failed with status ${response.status}`);
    }

    const html = await response.text();

    return {
      query,
      results: parseResults(html, limit),
    };
  },
};
