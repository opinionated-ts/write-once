import { error, isFailure, ok } from "@opinionated-ts/result";

import type { SourceIndexCache } from "../source-index-cache.js";
import type {
  ContentExtractor,
  NamedDeclaration,
  ResourceContext,
  ResolvedContent,
  SourceLocation,
  SourceSelector,
  TextSpan,
} from "../types.js";

import { ContentExtractionError } from "../errors/content-extraction-error.js";
import { scanMarkers } from "../marker-scanner.js";
import { coordinateAt } from "../text-index.js";

function contentLocation(resource: ResolvedContent, text: string, span: TextSpan): SourceLocation {
  return {
    resource: resource.location,
    start: coordinateAt(text, span.start),
    end: coordinateAt(text, span.end),
  };
}

function findDeclaration(declarations: NamedDeclaration[], name: string) {
  return declarations.find((declaration) => declaration.name === name);
}

function extractNamedFragmentResult(
  resource: ResolvedContent,
  selector: SourceSelector,
  sourceIndexes?: SourceIndexCache,
) {
  if (selector.kind !== "named") {
    return error(
      ContentExtractionError({
        message: "The named-fragment extractor requires a named selector.",
        context: { public: { selector: selector.kind, resource: resource.location } },
      }),
    );
  }

  if (typeof resource.text !== "string") {
    return error(
      ContentExtractionError({
        message: `Resource "${resource.location}" does not provide text for named-fragment extraction.`,
        context: {
          public: { resourceId: resource.id, location: resource.location, name: selector.name },
        },
      }),
    );
  }

  const scanned =
    sourceIndexes?.scanMarkers(resource, { resource: resource.location }) ??
    scanMarkers(resource.text, { resource: resource.location });
  if (isFailure(scanned)) return error(scanned.error);

  const declaration = findDeclaration(scanned.value.declarations, selector.name);
  if (declaration === undefined) {
    return error(
      ContentExtractionError({
        message: `Named fragment "${selector.name}" was not found in source "${resource.location}".`,
        context: {
          public: { resourceId: resource.id, location: resource.location, name: selector.name },
        },
      }),
    );
  }

  return ok({
    text: resource.text.slice(declaration.contentSpan.start, declaration.contentSpan.end),
    location: contentLocation(resource, resource.text, declaration.contentSpan),
    metadata: {
      ...resource.metadata,
      resourceId: resource.id,
      resourceLocation: resource.location,
      fragmentName: declaration.name,
    },
  });
}

// Extracts a named read-only declaration from one resolved resource.
export function createNamedFragmentExtractor(sourceIndexes?: SourceIndexCache) {
  return {
    id: "named-fragment-text",
    canExtract(_resource: ResolvedContent, selector: SourceSelector, _context: ResourceContext) {
      return selector.kind === "named";
    },
    extract(resource: ResolvedContent, selector: SourceSelector) {
      const result = extractNamedFragmentResult(resource, selector, sourceIndexes);
      if (isFailure(result)) throw result.error;
      return result.value;
    },
    extractResult: (resource: ResolvedContent, selector: SourceSelector) =>
      extractNamedFragmentResult(resource, selector, sourceIndexes),
  } satisfies ContentExtractor;
}

export const namedFragmentExtractor = createNamedFragmentExtractor();
