import { Type } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "./types.js";

export interface WebFetchInput {
  url: string;
  format?: "text" | "html";
}

export interface WebFetchOutput {
  url: string;
  status: number;
  content: string;
}

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

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " "))
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const webFetchTool: ToolDefinition<WebFetchInput, WebFetchOutput> = {
  name: "webfetch",
  description: "Fetch a web page and return either extracted text or raw HTML.",
  parameters: Type.Object({
    url: Type.String(),
    format: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("html")])),
  }),
  async run(input: WebFetchInput) {
    const rawUrl = input.url.trim();
    if (!rawUrl) {
      throw new Error("url must not be empty");
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      throw new Error("url must be a valid absolute URL");
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("url must use http or https");
    }

    const response = await fetch(parsedUrl, {
      headers: {
        "user-agent": "MiniOpenClaw/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`web fetch failed with status ${response.status}`);
    }

    const html = await response.text();

    return {
      url: parsedUrl.toString(),
      status: response.status,
      content: input.format === "html" ? html : stripHtml(html),
    };
  },
};
