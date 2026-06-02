import assert from "node:assert/strict";
import { test } from "vitest";
import { webFetchTool } from "../src/agent/tools/tool-registry.js";

const originalFetch = globalThis.fetch;

function restoreEnvironment(): void {
  globalThis.fetch = originalFetch;
}

test("webFetchTool returns text content by default", async () => {
  try {
    globalThis.fetch = async (input) => {
      assert.equal(String(input), "https://example.com/");

      return new Response("<html><body><h1>Hello</h1><p>World</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    };

    const result = await webFetchTool.run({ url: "https://example.com" });

    assert.deepEqual(result, {
      url: "https://example.com/",
      status: 200,
      content: "Hello World",
    });
  } finally {
    restoreEnvironment();
  }
});

test("webFetchTool returns raw html when requested", async () => {
  try {
    globalThis.fetch = async () =>
      new Response("<html><body><p>Test</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });

    const result = await webFetchTool.run({
      url: "https://example.com/page",
      format: "html",
    });

    assert.equal(result.content, "<html><body><p>Test</p></body></html>");
  } finally {
    restoreEnvironment();
  }
});

test("webFetchTool rejects empty urls", async () => {
  await assert.rejects(() => webFetchTool.run({ url: "   " }));
});

test("webFetchTool rejects invalid urls", async () => {
  await assert.rejects(() => webFetchTool.run({ url: "not-a-url" }));
});

test("webFetchTool rejects non-http urls", async () => {
  await assert.rejects(() => webFetchTool.run({ url: "file:///tmp/test.txt" }));
});

test("webFetchTool throws on HTTP errors", async () => {
  try {
    globalThis.fetch = async () => new Response("failed", { status: 404 });

    await assert.rejects(() => webFetchTool.run({ url: "https://example.com" }));
  } finally {
    restoreEnvironment();
  }
});
