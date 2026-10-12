import type {
  ContentExtractor,
  ResourceContext,
  ResolvedResource,
  SourceLocation,
  SourceSelector,
} from "../types.js";

import { ContentExtractionError } from "../errors/content-extraction-error.js";

function endCoordinate(text: string) {
  let line = 1;
  let column = 1;

  for (let index = 0; index < text.length; index += 1) {
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

function sourceLocation(resource: ResolvedResource, text: string): SourceLocation {
  return {
    resource: resource.location,
    start: { line: 1, column: 1 },
    end: endCoordinate(text),
  };
}

/** Extracts the complete text from a resource without normalizing its content. */
export const wholeFileExtractor = {
  id: "whole-file-text",
  canExtract(_resource: ResolvedResource, selector: SourceSelector, _context: ResourceContext) {
    return selector.kind === "whole";
  },
  extract(resource: ResolvedResource, selector: SourceSelector) {
    if (selector.kind !== "whole") {
      throw ContentExtractionError({
        message: "The whole-file extractor only supports whole-source selectors.",
        context: { public: { selector: selector.kind, resource: resource.location } },
      });
    }

    if (typeof resource.text !== "string") {
      throw ContentExtractionError({
        message: `Resource "${resource.location}" does not provide text for whole-file extraction.`,
        context: { public: { resourceId: resource.id, location: resource.location } },
      });
    }

    return {
      text: resource.text,
      location: sourceLocation(resource, resource.text),
      metadata: {
        ...resource.metadata,
        resourceId: resource.id,
        resourceLocation: resource.location,
      },
    };
  },
} satisfies ContentExtractor;
