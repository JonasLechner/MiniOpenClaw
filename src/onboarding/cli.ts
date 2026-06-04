import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function promptText(message: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(`${message.trim()} `)).trim();
  } finally {
    rl.close();
  }
}

export async function promptYesNo(message: string, defaultValue = true): Promise<boolean> {
  const suffix = defaultValue ? "[Y/n]" : "[y/N]";
  while (true) {
    const answer = (await promptText(`${message} ${suffix}`)).toLowerCase();
    if (!answer) return defaultValue;
    if (["y", "yes"].includes(answer)) return true;
    if (["n", "no"].includes(answer)) return false;
  }
}

export async function promptSelect(message: string, options: string[]): Promise<string> {
  if (options.length === 0) {
    throw new Error("No options available.");
  }

  output.write(`${message}\n`);
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
