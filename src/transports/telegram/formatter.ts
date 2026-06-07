const TELEGRAM_MAX_MESSAGE_LENGTH = 4000;
const TELEGRAM_MARKDOWN_V2_PARSE_MODE = "MarkdownV2";
const TELEGRAM_MARKDOWN_V2_SPECIAL_CHARACTERS = /[_*\[\]()~`>#+\-=|{}.!\\]/g;

function escapeTelegramMarkdownV2Text(text: string): string {
  return text.replace(TELEGRAM_MARKDOWN_V2_SPECIAL_CHARACTERS, "\\$&");
}

function escapeTelegramMarkdownV2Code(text: string): string {
  return text.replace(/[\\`]/g, "\\$&");
}

function escapeTelegramMarkdownV2LinkUrl(url: string): string {
  return url.replace(/[\\)]/g, "\\$&");
}

function formatTelegramMarkdownV2Segment(text: string): string {
  const parts: string[] = [];
  const pattern = /```([^\n`]*)\n?([\s\S]*?)```|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\n]+)\)|\*\*([^*](?:[\s\S]*?[^*])?)\*\*|__([^_](?:[\s\S]*?[^_])?)__|_([^_](?:[\s\S]*?[^_])?)_|~([^~](?:[\s\S]*?[^~])?)~/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push(escapeTelegramMarkdownV2Text(text.slice(lastIndex, index)));
    }

    const [fullMatch, language = "", fencedCode, inlineCode, linkLabel, linkUrl, boldText, underlineText, italicText, strikethroughText] = match;
    if (fencedCode !== undefined) {
      const normalizedLanguage = language.trim().replace(/[^a-zA-Z0-9_+-]/g, "");
      const languagePrefix = normalizedLanguage ? normalizedLanguage : "";
      parts.push(`\`\`\`${languagePrefix}\n${escapeTelegramMarkdownV2Code(fencedCode)}\`\`\``);
    } else if (inlineCode !== undefined) {
      parts.push(`\`${escapeTelegramMarkdownV2Code(inlineCode)}\``);
    } else if (linkLabel !== undefined && linkUrl !== undefined) {
      parts.push(`[${escapeTelegramMarkdownV2Text(linkLabel)}](${escapeTelegramMarkdownV2LinkUrl(linkUrl)})`);
    } else if (boldText !== undefined) {
      parts.push(`*${escapeTelegramMarkdownV2Text(boldText)}*`);
    } else if (underlineText !== undefined) {
      parts.push(`__${escapeTelegramMarkdownV2Text(underlineText)}__`);
    } else if (italicText !== undefined) {
      parts.push(`_${escapeTelegramMarkdownV2Text(italicText)}_`);
    } else if (strikethroughText !== undefined) {
      parts.push(`~${escapeTelegramMarkdownV2Text(strikethroughText)}~`);
    }

    lastIndex = index + fullMatch.length;
  }

  if (lastIndex < text.length) {
    parts.push(escapeTelegramMarkdownV2Text(text.slice(lastIndex)));
  }

  return parts.join("");
}

export function telegramParseMode(): "MarkdownV2" {
  return TELEGRAM_MARKDOWN_V2_PARSE_MODE;
}

export function normalizeTelegramText(text: string): string {
  return text.trim() || "(no response)";
}

export function formatTelegramMarkdownV2(text: string): string {
  return formatTelegramMarkdownV2Segment(normalizeTelegramText(text));
}

export function chunkTelegramText(text: string): string[] {
  const formatted = formatTelegramMarkdownV2(text);
  if (formatted.length <= TELEGRAM_MAX_MESSAGE_LENGTH) {
    return [formatted];
  }

  const chunks: string[] = [];
  let remaining = formatted;

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
