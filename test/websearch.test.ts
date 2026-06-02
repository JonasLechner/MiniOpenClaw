import assert from "node:assert/strict";
import { test } from "vitest";
import { webSearchTool } from "../src/agent/tools/tool-registry.js";

const originalFetch = globalThis.fetch;

function restoreEnvironment(): void {
  globalThis.fetch = originalFetch;
}

test("webSearchTool returns parsed results", async () => {
  try {
    globalThis.fetch = async () =>
      new Response(`
        <html>
          <body>
            <a class="result__a" href="https://example.com/a">Example &amp; One</a>
            <div class="result__snippet">First <b>snippet</b>.</div>
            <a class="result__a" href="https://example.com/b">Example Two</a>
            <div class="result__snippet">Second snippet.</div>
          </body>
        </html>
      `, {
        status: 200,
        headers: { "content-type": "text/html" },
      });

    const result = await webSearchTool.run({ query: "example", limit: 2 });

    assert.deepEqual(result, {
      query: "example",
      results: [
        {
          title: "Example & One",
          url: "https://example.com/a",
          snippet: "First snippet.",
        },
        {
          title: "Example Two",
          url: "https://example.com/b",
          snippet: "Second snippet.",
        },
      ],
    });
  } finally {
    restoreEnvironment();
  }
});

test("webSearchTool enforces the result limit", async () => {
  try {
    globalThis.fetch = async () =>
      new Response(`
        <a class="result__a" href="https://example.com/a">One</a>
        <div class="result__snippet">Snippet 1</div>
        <a class="result__a" href="https://example.com/b">Two</a>
        <div class="result__snippet">Snippet 2</div>
      `, { status: 200 });

    const result = await webSearchTool.run({ query: "example", limit: 1 });

    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]?.title, "One");
  } finally {
    restoreEnvironment();
  }
});

test("webSearchTool rejects empty queries", async () => {
  await assert.rejects(() => webSearchTool.run({ query: "   " }));
});

test("webSearchTool rejects invalid limits", async () => {
  await assert.rejects(() => webSearchTool.run({ query: "example", limit: 0 }));
});

test("webSearchTool throws on HTTP errors", async () => {
  try {
    globalThis.fetch = async () => new Response("failed", { status: 503 });

    await assert.rejects(() => webSearchTool.run({ query: "example" }));
  } finally {
    restoreEnvironment();
  }
});
