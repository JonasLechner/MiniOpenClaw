import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

let home: string | undefined;

afterEach(() => {
  if (home) {
    rmSync(home, { recursive: true, force: true });
    home = undefined;
  }
  vi.resetModules();
  vi.doUnmock("node:os");
});

it("defaults sandboxing to enabled for new config files", async () => {
  home = mkdtempSync(join(tmpdir(), "miniopenclaw-config-test-"));
  vi.doMock("node:os", async () => {
    const actual = await vi.importActual<typeof import("node:os")>("node:os");
    return {
      ...actual,
      homedir: () => home as string,
    };
  });

  const { loadRuntimeConfig } = await import("../src/lib/config.js");
  const runtime = loadRuntimeConfig();

  expect(runtime.config.sandbox.enabled).toBe(true);
  expect(runtime.config.sandbox.engine).toBe("auto");
  expect(runtime.config.sandbox.image).toBe("miniopenclaw-sandbox:local");

  const persisted = JSON.parse(readFileSync(runtime.paths.configFile, "utf8")) as {
    sandbox?: { enabled?: boolean; image?: string };
  };
  expect(persisted.sandbox?.enabled).toBe(true);
  expect(persisted.sandbox?.image).toBe("miniopenclaw-sandbox:local");
});


