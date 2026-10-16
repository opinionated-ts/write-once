import type { TextCoordinate } from "./types.js";

export interface TextLine {
  text: string;
  start: number;
  contentEnd: number;
  end: number;
  number: number;
}

// Split text without normalizing LF, CRLF, or lone-CR line endings.
export function getTextLines(text: string): TextLine[] {
  const lines: TextLine[] = [];
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
    lines.push({
      text: "",
      start: text.length,
      contentEnd: text.length,
      end: text.length,
      number,
    });
  }

  return lines;
}

// Return the 1-based line and UTF-16 column using precomputed line offsets.
export function coordinateAtOffset(lines: readonly TextLine[], offset: number): TextCoordinate {
  let low = 0;
  let high = lines.length - 1;

  while (low <= high) {
    const middle = (low + high) >>> 1;
    const line = lines[middle]!;
    if (offset < line.start) {
      high = middle - 1;
    } else if (middle + 1 < lines.length && offset >= lines[middle + 1]!.start) {
      low = middle + 1;
    } else {
      if (offset > line.contentEnd && offset < line.end) {
        return { line: line.number + 1, column: 1 };
      }
      return { line: line.number, column: offset - line.start + 1 };
    }
  }

  const last = lines[lines.length - 1];
  return last === undefined
    ? { line: 1, column: 1 }
    : { line: last.number, column: offset - last.start + 1 };
}

// Return the 1-based line and UTF-16 column for a source offset.
export function coordinateAt(text: string, offset: number): TextCoordinate {
  let line = 1;
  let column = 1;

  for (let index = 0; index < offset; index += 1) {
    if (text[index] === "\r") {
      if (text[index + 1] === "\n") index += 1;
      line += 1;
      column = 1;
    } else if (text[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
}
