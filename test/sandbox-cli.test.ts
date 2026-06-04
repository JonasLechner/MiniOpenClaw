import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import { writeUserConfig, type UserConfig } from "../src/core/config.js";
import { vi } from "vitest";

let root: string | undefined;
const previousHome = process.env.HOME;
const previousUserProfile = process.env.USERPROFILE;

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true });
    root = undefined;
  }

  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }

  if (previousUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = previousUserProfile;
  }
});

test("sandbox:disable updates config to disable sandboxing", async () => {
  root = mkdtempSync(join(tmpdir(), "miniopenclaw-sandbox-cli-"));
  process.env.HOME = root;
  process.env.USERPROFILE = root;

  const configFile = join(root, ".mini-openclaw", "config.json");
  writeUserConfig(configFile, {
    sandbox: {
      enabled: true,
      engine: "auto",
      image: "miniopenclaw-sandbox:local",
      network: "none",
    },
  } satisfies UserConfig);

  vi.resetModules();
  const { main } = await import("../src/sandbox-cli.js");
  await main(["disable"]);

  const config = JSON.parse(readFileSync(configFile, "utf8")) as UserConfig;
  assert.equal(config.sandbox?.enabled, false);
});
