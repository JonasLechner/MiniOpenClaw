export const DEFAULT_MAX_OUTPUT_LINES = 2000;
export const DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024;

export interface TruncationDetails {
  truncated: boolean;
  truncatedBy: "lines" | "bytes" | null;
  totalLines: number;
  totalBytes: number;
  outputLines: number;
  outputBytes: number;
  maxLines: number;
  maxBytes: number;
}

export interface TruncationResult {
  content: string;
  details: TruncationDetails;
}

function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }
  return content.split(/\r?\n/).length;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  return `${Math.round(bytes / 1024)}KB`;
}

export function truncateHead(
  content: string,
  maxLines = DEFAULT_MAX_OUTPUT_LINES,
  maxBytes = DEFAULT_MAX_OUTPUT_BYTES,
): TruncationResult {
  const totalBytes = Buffer.byteLength(content, "utf8");
  const allLines = content.length === 0 ? [] : content.split(/\r?\n/);
  const totalLines = allLines.length;

  let output = content;
  let truncatedBy: TruncationDetails["truncatedBy"] = null;

  if (allLines.length > maxLines) {
    output = allLines.slice(0, maxLines).join("\n");
    truncatedBy = "lines";
  }

  if (Buffer.byteLength(output, "utf8") > maxBytes) {
    const selectedLines: string[] = [];
    let selectedBytes = 0;

    for (const line of output.split(/\r?\n/)) {
      const separatorBytes = selectedLines.length === 0 ? 0 : 1;
      const lineBytes = Buffer.byteLength(line, "utf8") + separatorBytes;
      if (selectedBytes + lineBytes > maxBytes) {
        if (selectedLines.length === 0) {
          selectedLines.push(Buffer.from(line, "utf8").subarray(0, maxBytes).toString("utf8"));
        }
        break;
      }
      selectedLines.push(line);
      selectedBytes += lineBytes;
    }

    output = selectedLines.join("\n");
    truncatedBy = "bytes";
  }

  const outputBytes = Buffer.byteLength(output, "utf8");

  return {
    content: output,
    details: {
      truncated: truncatedBy !== null,
      truncatedBy,
      totalLines,
      totalBytes,
      outputLines: countLines(output),
      outputBytes,
      maxLines,
      maxBytes,
    },
  };
}

export function truncationNotice(details: TruncationDetails, nextHint?: string): string {
  if (!details.truncated) {
    return "";
  }

  const limit = details.truncatedBy === "lines"
    ? `${details.maxLines} line limit`
    : `${formatBytes(details.maxBytes)} limit`;

  const hint = nextHint ? ` ${nextHint}` : "";
  return `\n\n[Truncated: showing ${details.outputLines} of ${details.totalLines} lines (${limit}).${hint}]`;
}
