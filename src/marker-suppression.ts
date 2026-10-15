import { hasMarkerKind } from "./marker-parser.js";

export interface SuppressionDiagnostic {
  message: string;
  offset: number;
  line: number;
  column: number;
}

export interface SuppressionResult {
  text: string;
  diagnostic?: SuppressionDiagnostic;
}

interface LineRecord {
  text: string;
  start: number;
  contentEnd: number;
  end: number;
  number: number;
}

const DIRECTIVE = /(?<![A-Za-z0-9_-])write-once-ignore-(next|start|end)(?![A-Za-z0-9_-])/g;

function getLines(text: string): LineRecord[] {
  const lines: LineRecord[] = [];
  let start = 0;
  let number = 1;

  while (start < text.length) {
    let contentEnd = start;
    while (contentEnd < text.length && text[contentEnd] !== "\n" && text[contentEnd] !== "\r") {
      contentEnd += 1;
    }

    let end = contentEnd;
    if (text[end] === "\r" && text[end + 1] === "\n") end += 2;
    else if (text[end] === "\r" || text[end] === "\n") end += 1;

    lines.push({ text: text.slice(start, contentEnd), start, contentEnd, end, number });
    start = end;
    number += 1;
  }

  if (text.length === 0 || /[\r\n]$/.test(text)) {
    lines.push({ text: "", start: text.length, contentEnd: text.length, end: text.length, number });
  }

  return lines;
}

function diagnostic(message: string, line: LineRecord, offset = line.start): SuppressionDiagnostic {
  return { message, offset, line: line.number, column: offset - line.start + 1 };
}

function maskLine(characters: string[], line: LineRecord): void {
  for (let index = line.start; index < line.contentEnd; index += 1) characters[index] = " ";
}

/**
 * Masks suppressed lines without changing offsets or line endings, so the marker
 * scanner can preserve source spans while ignoring selected fragments.
 */
export function applySuppressionDirectives(text: string): SuppressionResult {
  const lines = getLines(text);
  const characters = text.split("");
  let regionStart: LineRecord | undefined;
  let pendingNext: LineRecord | undefined;
  let skippingNext = false;

  for (const line of lines) {
    if (skippingNext) {
      maskLine(characters, line);
      if (hasMarkerKind(line.text, "close")) skippingNext = false;
      continue;
    }

    const directives = [...line.text.matchAll(DIRECTIVE)];
    if (directives.length > 1) {
      return {
        text,
        diagnostic: diagnostic(
          "A line cannot contain multiple write-once suppression directives.",
          line,
          line.start + directives[1]!.index,
        ),
      };
    }

    const directive = directives[0];
    if (directive !== undefined) {
      const kind = directive[1];
      if (kind === "start") {
        if (regionStart !== undefined) {
          return {
            text,
            diagnostic: diagnostic(
              "Suppression regions cannot be nested.",
              line,
              line.start + directive.index,
            ),
          };
        }
        if (pendingNext !== undefined) {
          return {
            text,
            diagnostic: diagnostic(
              "A suppression region cannot start while ignore-next is pending.",
              line,
              line.start + directive.index,
            ),
          };
        }
        regionStart = line;
      } else if (kind === "end") {
        if (regionStart === undefined) {
          return {
            text,
            diagnostic: diagnostic(
              "Suppression region end has no matching start.",
              line,
              line.start + directive.index,
            ),
          };
        }
        regionStart = undefined;
      } else {
        if (pendingNext !== undefined) {
          return {
            text,
            diagnostic: diagnostic(
              "An ignore-next directive must be followed by a fragment before another ignore-next directive.",
              line,
              line.start + directive.index,
            ),
          };
        }
        if (regionStart === undefined) pendingNext = line;
      }
      maskLine(characters, line);
      continue;
    }

    if (regionStart !== undefined) {
      maskLine(characters, line);
      continue;
    }

    if (pendingNext !== undefined && hasMarkerKind(line.text, "open")) {
      maskLine(characters, line);
      pendingNext = undefined;
      skippingNext = !hasMarkerKind(line.text, "close");
    }
  }

  if (regionStart !== undefined) {
    return {
      text,
      diagnostic: diagnostic("Suppression region has no matching end directive.", regionStart),
    };
  }
  if (pendingNext !== undefined) {
    return {
      text,
      diagnostic: diagnostic(
        "Ignore-next directive has no following fragment marker.",
        pendingNext,
      ),
    };
  }

  return { text: characters.join("") };
}
