import { describe, expect, it } from "vitest";
import { chunkTelegramText, formatTelegramMarkdownV2 } from "../src/transports/telegram/formatter.js";

describe("telegram formatter", () => {
  it("escapes plain text for MarkdownV2", () => {
    expect(formatTelegramMarkdownV2("Hello [world]! (v2)"))
      .toBe("Hello \\[world\\]\\! \\(v2\\)");
  });

  it("preserves the supported Markdown subset", () => {
    expect(formatTelegramMarkdownV2("**Bold** _italic_ __underline__ ~strike~ [label](https://example.com) `x.y()`\n```ts\nconst x = 1;\n```"))
      .toBe(["*Bold* _italic_ __underline__ ~strike~ [label](https://example.com) `x.y()`", "```ts", "const x = 1;", "```"].join("\n"));
  });

  it("escapes formatting characters inside link labels", () => {
    expect(formatTelegramMarkdownV2("[hello_world!](https://example.com)"))
      .toBe("[hello\\_world\\!](https://example.com)");
  });

  it("chunks already-formatted MarkdownV2 text", () => {
    const chunks = chunkTelegramText("**x**".repeat(1500));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(formatTelegramMarkdownV2("**x**".repeat(1500)));
  });
});
