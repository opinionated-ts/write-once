import type {
  ContentExtractor,
  ResourceContext,
  ResolvedContent,
  SourceLocation,
  SourceSelector,
  TextCoordinate,
  TextRange,
} from "../types.js";

import { ContentExtractionError } from "../errors/content-extraction-error.js";

interface LineRecord {
  start: number;
  contentEnd: number;
}

function getLines(text: string): LineRecord[] {
  const lines: LineRecord[] = [];
  let start = 0;

  while (start < text.length) {
    let contentEnd = start;
    while (contentEnd < text.length && text[contentEnd] !== "\r" && text[contentEnd] !== "\n") {
      contentEnd += 1;
    }

    let end = contentEnd;
    if (text[end] === "\r" && text[end + 1] === "\n") end += 2;
    else if (text[end] === "\r" || text[end] === "\n") end += 1;

    lines.push({ start, contentEnd });
    start = end;
  }

  if (text.length === 0 || text.endsWith("\n") || text.endsWith("\r")) {
    lines.push({ start: text.length, contentEnd: text.length });
  }

  return lines;
}

function offsetAt(
  lines: LineRecord[],
  coordinate: TextCoordinate,
  resource: string,
  edge: string,
): number {
  const line = lines[coordinate.line - 1];
  if (line === undefined) {
    throw ContentExtractionError({
      message: `Range ${edge} line ${coordinate.line} is outside source "${resource}".`,
      context: { public: { resource, edge, coordinate } },
    });
  }

  const maxColumn = line.contentEnd - line.start + 1;
  if (coordinate.column < 1 || coordinate.column > maxColumn) {
    throw ContentExtractionError({
      message: `Range ${edge} column ${coordinate.column} is outside line ${coordinate.line} in source "${resource}".`,
      context: { public: { resource, edge, coordinate, maxColumn } },
    });
  }

  return line.start + coordinate.column - 1;
}

function rangeLocation(resource: ResolvedContent, range: TextRange): SourceLocation {
  return { resource: resource.location, start: range.start, end: range.end };
}

/** Extracts a precise UTF-16 line-and-column range from source text. */
export const rangeExtractor = {
  id: "line-column-range-text",
  canExtract(_resource: ResolvedContent, selector: SourceSelector, _context: ResourceContext) {
    return selector.kind === "range";
  },
  extract(resource: ResolvedContent, selector: SourceSelector) {
    if (selector.kind !== "range") {
      throw ContentExtractionError({
        message: "The range extractor requires a range selector.",
        context: { public: { selector: selector.kind, resource: resource.location } },
      });
    }

    if (typeof resource.text !== "string") {
      throw ContentExtractionError({
        message: `Resource "${resource.location}" does not provide text for range extraction.`,
        context: { public: { resourceId: resource.id, location: resource.location } },
      });
    }

    const lines = getLines(resource.text);
    const start = offsetAt(lines, selector.range.start, resource.location, "start");
    const end = offsetAt(lines, selector.range.end, resource.location, "end");
    if (end < start) {
      throw ContentExtractionError({
        message: `Range end precedes range start in source "${resource.location}".`,
        context: { public: { resource: resource.location, range: selector.range } },
      });
    }

    return {
      text: resource.text.slice(start, end),
      location: rangeLocation(resource, selector.range),
      metadata: {
        ...resource.metadata,
        resourceId: resource.id,
        resourceLocation: resource.location,
        range: selector.range,
      },
    };
  },
} satisfies ContentExtractor;
