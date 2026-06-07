import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

function supportsColor(): boolean {
  return Boolean(output.isTTY && process.env.NO_COLOR === undefined);
}

function bold(text: string): string {
  return supportsColor() ? `\x1b[1m${text}\x1b[0m` : text;
}

function cyan(text: string): string {
  return supportsColor() ? `\x1b[36m${text}\x1b[0m` : text;
}

function dim(text: string): string {
  return supportsColor() ? `\x1b[2m${text}\x1b[0m` : text;
}

export function printHeading(text: string): void {
  output.write(`\n${bold(cyan(text))}\n`);
}

export function printSummaryItem(label: string, value: string): void {
  output.write(`${dim("- ")}${bold(label)} ${value}\n`);
}

export async function promptText(message: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(`${bold(message.trim())} `)).trim();
  } finally {
    rl.close();
  }
}

export async function promptMultilineText(message: string): Promise<string> {
  printHeading(message);
  output.write(`${dim("Finish by entering a blank line.")}\n`);

  const rl = createInterface({ input, output });
  const lines: string[] = [];
  try {
    while (true) {
      const line = (await rl.question(lines.length === 0 ? "> " : "")).trimEnd();
      if (!line.trim()) {
        if (lines.length === 0) {
          continue;
        }
        break;
      }
      lines.push(line);
    }
  } finally {
    rl.close();
  }

  return lines.join("\n").trim();
}

export async function promptYesNo(message: string, defaultValue = true): Promise<boolean> {
  const suffix = defaultValue ? dim("[y/n, default: yes]") : dim("[y/n, default: no]");
  while (true) {
    const answer = (await promptText(`${message} ${suffix}`)).toLowerCase();
    if (!answer) return defaultValue;
    if (["y", "yes"].includes(answer)) return true;
    if (["n", "no"].includes(answer)) return false;
  }
}

async function promptSelectInteractive(message: string, options: string[]): Promise<string> {
  let selectedIndex = 0;
  let filter = "";

  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");

  function getVisibleOptions(): string[] {
    const normalizedFilter = filter.trim().toLowerCase();
    if (!normalizedFilter) {
      return options;
    }

    return options.filter((option) => option.toLowerCase().includes(normalizedFilter));
  }

  function writeMenu() {
    const visibleOptions = getVisibleOptions();
    const totalOptions = visibleOptions.length;
    if (selectedIndex >= totalOptions) {
      selectedIndex = totalOptions > 0 ? totalOptions - 1 : 0;
    }

    output.write(`${bold(message)}\n`);
    output.write(`${dim("Filter: ")}${filter || dim("(type to filter)")}\n\n`);

    if (visibleOptions.length === 0) {
      output.write(`${dim("  No matches\n")}`);
    } else {
      for (let i = 0; i < visibleOptions.length; i++) {
        const prefix = i === selectedIndex ? `${cyan("> ")}` : "  ";
        const label = i === selectedIndex ? bold(visibleOptions[i]) : visibleOptions[i];
        output.write(`${prefix}${label}\n`);
      }
    }

    output.write(`\n${dim("Type to filter • ↑ / ↓ to move • Enter to select")}`);
    output.write("\n");
  }

  function render(previousLineCount: number) {
    output.write(`\x1b[${previousLineCount}A`);
    output.write("\x1b[J");
    writeMenu();
  }

  writeMenu();

  function cleanup() {
    input.removeAllListeners("data");
    input.setRawMode(false);
    input.pause();
  }

  return new Promise<string>((resolve, reject) => {
    function onData(key: string) {
      const bytes = Buffer.from(key);
      const previousLineCount = 5 + Math.max(getVisibleOptions().length, 1);

      if (bytes[0] === 0x03 || (bytes[0] === 0x1b && bytes.length === 1)) {
        cleanup();
        output.write("\n");
        reject(new Error("Cancelled by user."));
        return;
      }

      if (bytes[0] === 0x7f || bytes[0] === 0x08) {
        if (filter.length > 0) {
          filter = filter.slice(0, -1);
          selectedIndex = 0;
          render(previousLineCount);
        }
        return;
      }

      if (bytes[0] === 0x1b && bytes[1] === 0x5b) {
        const visibleOptions = getVisibleOptions();
        const code = bytes[2];
        if (code === 0x41 && visibleOptions.length > 0) {
          selectedIndex = selectedIndex <= 0 ? visibleOptions.length - 1 : selectedIndex - 1;
          render(previousLineCount);
          return;
        }
        if (code === 0x42 && visibleOptions.length > 0) {
          selectedIndex = selectedIndex >= visibleOptions.length - 1 ? 0 : selectedIndex + 1;
          render(previousLineCount);
          return;
        }
      }

      if (bytes[0] === 0x0d || bytes[0] === 0x0a) {
        const visibleOptions = getVisibleOptions();
        if (visibleOptions.length === 0) {
          return;
        }

        cleanup();
        output.write("\n");
        resolve(visibleOptions[selectedIndex]);
        return;
      }

      if (key >= " " && key !== "\u007f") {
        filter += key;
        selectedIndex = 0;
        render(previousLineCount);
      }
    }

    input.on("data", onData);
  });
}

export async function promptSelect(message: string, options: string[]): Promise<string> {
  if (options.length === 0) {
    throw new Error("No options available.");
  }

  if (input.isTTY && output.isTTY) {
    return promptSelectInteractive(message, options);
  }

  output.write(`${bold(message)}\n`);
  for (const [index, option] of options.entries()) {
    output.write(`  ${index + 1}. ${option}\n`);
  }

  while (true) {
    const answer = await promptText("Select an option by number:");
    const index = Number(answer);
    if (Number.isInteger(index) && index >= 1 && index <= options.length) {
      return options[index - 1];
    }
  }
}
