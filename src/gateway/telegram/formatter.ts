const TELEGRAM_MAX_MESSAGE_LENGTH = 4000;

export function normalizeTelegramText(text: string): string {
  return text.trim() || "(no response)";
}

export function chunkTelegramText(text: string): string[] {
  const normalized = normalizeTelegramText(text);
  if (normalized.length <= TELEGRAM_MAX_MESSAGE_LENGTH) {
    return [normalized];
  }

  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
    let splitAt = remaining.lastIndexOf("\n", TELEGRAM_MAX_MESSAGE_LENGTH);
    if (splitAt < TELEGRAM_MAX_MESSAGE_LENGTH / 2) {
      splitAt = TELEGRAM_MAX_MESSAGE_LENGTH;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}
