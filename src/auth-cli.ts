import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";
import { getOAuthProviders } from "@earendil-works/pi-ai/oauth";
import { runOAuthLogin } from "./agent/auth.js";
import { loadRuntimeConfig } from "./core/config.js";

function hasAuthForProvider(authFile: string, provider: string): boolean {
  if (!existsSync(authFile)) return false;
  const auth = JSON.parse(readFileSync(authFile, "utf8")) as Record<string, { type?: string }>;
  const entry = auth[provider];
  return entry !== undefined && entry.type !== "apiKey";
}

function getOAuthProviderOrThrow(providerId: string) {
  const provider = getOAuthProviders().find((candidate) => candidate.id === providerId);
  if (!provider) {
    throw new Error(`Provider "${providerId}" is not an OAuth provider.`);
  }
  return provider;
}

async function selectProviderInteractive(): Promise<string> {
  const providers = getOAuthProviders();

  if (providers.length === 0) {
    throw new Error("No OAuth providers available.");
  }

  let selectedIndex = 0;

  const stdin = process.stdin;
  const stdout = process.stdout;

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  const headerLines = 2; // "Select an OAuth provider:" + blank
  const footerLines = 2; // blank + "Use ↑ / ↓ ..."

  function render() {
    const totalLines = headerLines + providers.length + footerLines;
    stdout.write(`\x1b[${totalLines}A`);

    stdout.write("Select an OAuth provider:\n\n");
    for (let i = 0; i < providers.length; i++) {
      const prefix = i === selectedIndex ? "> " : "  ";
      stdout.write(`${prefix}${providers[i].name}\n`);
    }
    stdout.write("\nUse ↑ / ↓ to move, Enter to select\n");
  }

  stdout.write("Select an OAuth provider:\n\n");
  for (let i = 0; i < providers.length; i++) {
    const prefix = i === selectedIndex ? "> " : "  ";
    stdout.write(`${prefix}${providers[i].name}\n`);
  }
  stdout.write("\nUse ↑ / ↓ to move, Enter to select\n");

  function cleanup() {
    stdin.removeAllListeners("data");
    stdin.setRawMode(false);
    stdin.pause();
  }

  const selectedId = await new Promise<string>((resolve, reject) => {
    function onData(key: string) {
      const bytes = Buffer.from(key);

      if (bytes[0] === 0x03 || (bytes[0] === 0x1b && bytes.length === 1)) {
        cleanup();
        stdout.write("\n");
        reject(new Error("Cancelled by user."));
        return;
      }

      if (bytes[0] === 0x1b && bytes[1] === 0x5b) {
        const code = bytes[2];
        if (code === 0x41) {
          selectedIndex = selectedIndex <= 0 ? providers.length - 1 : selectedIndex - 1;
          render();
          return;
        }
        if (code === 0x42) {
          selectedIndex = selectedIndex >= providers.length - 1 ? 0 : selectedIndex + 1;
          render();
          return;
        }
      }

      if (bytes[0] === 0x0d || bytes[0] === 0x0a) {
        cleanup();
        const totalLines = headerLines + providers.length + footerLines;
        stdout.write(`\x1b[${totalLines}A`);
        stdout.write(`\x1b[${totalLines}B`);
        resolve(providers[selectedIndex].id);
        return;
      }
    }

    stdin.on("data", onData);
  });

  return selectedId;
}

async function selectProvider(argv: string[]): Promise<string> {
  const explicitProvider = argv[0];
  if (explicitProvider) {
    return getOAuthProviderOrThrow(explicitProvider).id;
  }

  if (process.stdin.isTTY && process.stdout.isTTY) {
    return selectProviderInteractive();
  }

  throw new Error("Authentication requires an interactive TTY; no provider default is chosen. Re-run `npm run auth` in a terminal and select a provider, or pass an OAuth provider id explicitly.");
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const runtime = loadRuntimeConfig();
  const selectedProvider = await selectProvider(argv);

  const oauthProvider = getOAuthProviderOrThrow(selectedProvider);

  if (hasAuthForProvider(runtime.paths.authFile, selectedProvider)) {
    console.log(`\nAuthentication for "${selectedProvider}" is already configured.`);
    console.log(`Delete ${runtime.paths.authFile} if you want to re-authenticate.`);
    process.exit(0);
  }

  await runOAuthLogin(oauthProvider, runtime.paths.authFile);
}

const isEntrypoint = basename(process.argv[1] ?? "") === basename(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
