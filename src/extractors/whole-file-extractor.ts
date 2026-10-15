import { error, isFailure, ok } from "@opinionated-ts/result";

import type {
  ContentExtractor,
  ResourceContext,
  ResolvedContent,
  SourceLocation,
  SourceSelector,
} from "../types.js";

import { ContentExtractionError } from "../errors/content-extraction-error.js";
import { coordinateAt } from "../text-index.js";

function sourceLocation(resource: ResolvedContent, text: string): SourceLocation {
  return {
    resource: resource.location,
    start: { line: 1, column: 1 },
    end: coordinateAt(text, text.length),
  };
}

function extractWholeFileResult(resource: ResolvedContent, selector: SourceSelector) {
  if (selector.kind !== "whole") {
    return error(
      ContentExtractionError({
        message: "The whole-file extractor only supports whole-source selectors.",
        context: { public: { selector: selector.kind, resource: resource.location } },
      }),
    );
  }

  if (typeof resource.text !== "string") {
    return error(
      ContentExtractionError({
        message: `Resource "${resource.location}" does not provide text for whole-file extraction.`,
        context: { public: { resourceId: resource.id, location: resource.location } },
      }),
    );
  }

  return ok({
    text: resource.text,
    location: sourceLocation(resource, resource.text),
    metadata: {
      ...resource.metadata,
      resourceId: resource.id,
      resourceLocation: resource.location,
    },
  });
}

/** Extracts the complete text from a resource without normalizing its content. */
export const wholeFileExtractor = {
  id: "whole-file-text",
  canExtract(_resource: ResolvedContent, selector: SourceSelector, _context: ResourceContext) {
    return selector.kind === "whole";
  },
  extract(resource: ResolvedContent, selector: SourceSelector) {
    const result = extractWholeFileResult(resource, selector);
    if (isFailure(result)) throw result.error;
    return result.value;
  },
  extractResult: extractWholeFileResult,
} satisfies ContentExtractor;
