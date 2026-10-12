import { isFailure } from "@opinionated-ts/result";

import type {
  ContentExtractor,
  NamedDeclaration,
  ResourceContext,
  ResolvedResource,
  SourceLocation,
  SourceSelector,
  TextSpan,
} from "../types.js";

import { ContentExtractionError } from "../errors/content-extraction-error.js";
import { scanMarkers } from "../marker-scanner.js";

function coordinateAt(text: string, offset: number) {
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

function contentLocation(resource: ResolvedResource, text: string, span: TextSpan): SourceLocation {
  return {
    resource: resource.location,
    start: coordinateAt(text, span.start),
    end: coordinateAt(text, span.end),
  };
}

function findDeclaration(declarations: NamedDeclaration[], name: string) {
  return declarations.find((declaration) => declaration.name === name);
}

/** Extracts a named read-only declaration from one resolved resource. */
export const namedFragmentExtractor = {
  id: "named-fragment-text",
  canExtract(_resource: ResolvedResource, selector: SourceSelector, _context: ResourceContext) {
    return selector.kind === "named";
  },
  extract(resource: ResolvedResource, selector: SourceSelector) {
    if (selector.kind !== "named") {
      throw ContentExtractionError({
        message: "The named-fragment extractor requires a named selector.",
        context: { public: { selector: selector.kind, resource: resource.location } },
      });
    }

    if (typeof resource.text !== "string") {
      throw ContentExtractionError({
        message: `Resource "${resource.location}" does not provide text for named-fragment extraction.`,
        context: {
          public: { resourceId: resource.id, location: resource.location, name: selector.name },
        },
      });
    }

    const scanned = scanMarkers(resource.text, { resource: resource.location });
    if (isFailure(scanned)) throw scanned.error;

    const declaration = findDeclaration(scanned.value.declarations, selector.name);
    if (declaration === undefined) {
      throw ContentExtractionError({
        message: `Named fragment "${selector.name}" was not found in source "${resource.location}".`,
        context: {
          public: { resourceId: resource.id, location: resource.location, name: selector.name },
        },
      });
    }

    return {
      text: resource.text.slice(declaration.contentSpan.start, declaration.contentSpan.end),
      location: contentLocation(resource, resource.text, declaration.contentSpan),
      metadata: {
        ...resource.metadata,
        resourceId: resource.id,
        resourceLocation: resource.location,
        fragmentName: declaration.name,
      },
    };
  },
} satisfies ContentExtractor;
