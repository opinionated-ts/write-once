import { error, isFailure, ok } from "@opinionated-ts/result";

import type { SourceIndexCache } from "../source-index-cache.js";
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
import { getTextLines } from "../text-index.js";

function offsetAt(
  lines: ReturnType<typeof getTextLines>,
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

function extractRangeResult(
  resource: ResolvedContent,
  selector: SourceSelector,
  sourceIndexes?: SourceIndexCache,
) {
  if (selector.kind !== "range") {
    return error(
      ContentExtractionError({
        message: "The range extractor requires a range selector.",
        context: { public: { selector: selector.kind, resource: resource.location } },
      }),
    );
  }

  if (typeof resource.text !== "string") {
    return error(
      ContentExtractionError({
        message: `Resource "${resource.location}" does not provide text for range extraction.`,
        context: { public: { resourceId: resource.id, location: resource.location } },
      }),
    );
  }

  const lines = sourceIndexes?.getTextLines(resource) ?? getTextLines(resource.text);
  let start: number;
  let end: number;
  try {
    start = offsetAt(lines, selector.range.start, resource.location, "start");
    end = offsetAt(lines, selector.range.end, resource.location, "end");
  } catch (cause) {
    return error(cause instanceof Error ? cause : new Error(String(cause)));
  }
  if (end < start) {
    return error(
      ContentExtractionError({
        message: `Range end precedes range start in source "${resource.location}".`,
        context: { public: { resource: resource.location, range: selector.range } },
      }),
    );
  }

  return ok({
    text: resource.text.slice(start, end),
    location: rangeLocation(resource, selector.range),
    metadata: {
      ...resource.metadata,
      resourceId: resource.id,
      resourceLocation: resource.location,
      range: selector.range,
    },
  });
}

/** Extracts a precise UTF-16 line-and-column range from source text. */
export function createRangeExtractor(sourceIndexes?: SourceIndexCache) {
  return {
    id: "line-column-range-text",
    canExtract(_resource: ResolvedContent, selector: SourceSelector, _context: ResourceContext) {
      return selector.kind === "range";
    },
    extract(resource: ResolvedContent, selector: SourceSelector) {
      const result = extractRangeResult(resource, selector, sourceIndexes);
      if (isFailure(result)) throw result.error;
      return result.value;
    },
    extractResult: (resource: ResolvedContent, selector: SourceSelector) =>
      extractRangeResult(resource, selector, sourceIndexes),
  } satisfies ContentExtractor;
}

export const rangeExtractor = createRangeExtractor();
