import { error, isFailure, ok } from "@opinionated-ts/result";

import type {
  MarkerBlock,
  MarkerToken,
  NamedDeclaration,
  SourceLocation,
  TextSpan,
} from "./types.js";

import { MarkerStructureError } from "./errors/marker-structure-error.js";
import { parseMarkerLine } from "./marker-parser.js";
import { applySuppressionDirectives } from "./marker-suppression.js";
import { coordinateAtOffset, getTextLines } from "./text-index.js";

export interface ScanMarkersOptions {
  // Identifier included in diagnostics. Defaults to "<input>".
  resource?: string;
}

export interface MarkerScanResult {
  blocks: MarkerBlock[];
  declarations: NamedDeclaration[];
}

interface OpenMarker {
  token: MarkerToken;
  isGenerated: boolean;
  name?: string;
  declarationParent?: string;
}

function locationForSpan(
  resource: string,
  lines: ReturnType<typeof getTextLines>,
  span: TextSpan,
): SourceLocation {
  return {
    resource,
    start: coordinateAtOffset(lines, span.start),
    end: coordinateAtOffset(lines, span.end),
  };
}

function structureError(
  message: string,
  resource: string,
  token?: MarkerToken,
  extra: Record<string, unknown> = {},
) {
  const offset = token?.span.start ?? 0;
  const location = token?.location;

  return error(
    MarkerStructureError({
      message,
      context: {
        public: {
          resource,
          offset,
          ...(location === undefined
            ? {}
            : { line: location.start.line, column: location.start.column }),
          ...extra,
        },
      },
    }),
  );
}

// Scans marker lines and pairs blocks without reading files or interpreting
// host-language syntax. Delimiter lines are retained verbatim in their spans.
export function scanMarkers(text: string, options: ScanMarkersOptions = {}) {
  const resource = options.resource ?? "<input>";
  const stack: OpenMarker[] = [];
  const blocks: MarkerBlock[] = [];
  const declarations: NamedDeclaration[] = [];
  const declarationNames = new Map<string, MarkerToken>();
  const suppression = applySuppressionDirectives(text);
  if (suppression.diagnostic !== undefined) {
    const { message, offset, line, column } = suppression.diagnostic;
    return structureError(message, resource, undefined, { offset, line, column });
  }

  const lines = getTextLines(suppression.text);
  const linesByStart = new Map(lines.map((line) => [line.start, line]));

  for (const line of lines) {
    const parsed = parseMarkerLine(line.text, {
      resource,
      offset: line.start,
      line: line.number,
    });

    if (isFailure(parsed)) {
      return parsed;
    }

    const token = parsed.value;
    if (token === undefined) continue;

    if (token.kind === "open") {
      const source = token.attributes.source;
      const name = token.attributes.name;
      const isGenerated = source !== undefined;

      if (isGenerated && stack.some((item) => item.isGenerated)) {
        return structureError("Generated destinations cannot be nested.", resource, token);
      }

      if (!isGenerated && name !== undefined) {
        const previous = declarationNames.get(name);
        if (previous !== undefined) {
          return structureError('Duplicate named declaration "' + name + '".', resource, token, {
            name,
            previousOffset: previous.span.start,
            previousLine: previous.location.start.line,
            previousColumn: previous.location.start.column,
            line: token.location.start.line,
            column: token.location.start.column,
          });
        }
        declarationNames.set(name, token);
      }

      stack.push({
        token,
        isGenerated,
        ...(name === undefined ? {} : { name }),
        ...(stack.length === 0
          ? {}
          : stack[stack.length - 1]!.name === undefined
            ? {}
            : { declarationParent: stack[stack.length - 1]!.name }),
      });
      continue;
    }

    const opening = stack.pop();
    if (opening === undefined) continue;

    const openingLine = linesByStart.get(opening.token.lineSpan.start);
    const closingLine = line;

    if (openingLine === undefined) {
      return structureError(
        "Could not determine the opening marker line span.",
        resource,
        opening.token,
      );
    }

    const block: MarkerBlock = {
      opening: {
        ...opening.token,
        lineSpan: {
          start: openingLine.start,
          end: openingLine.end,
        },
      },
      closing: {
        ...token,
        lineSpan: {
          start: closingLine.start,
          end: closingLine.end,
        },
      },
      span: {
        start: openingLine.start,
        end: closingLine.end,
      },
      bodySpan: {
        start: openingLine.end,
        end: closingLine.start,
      },
    };

    blocks.push(block);

    if (!opening.isGenerated && opening.name !== undefined) {
      declarations.push({
        name: opening.name,
        marker: block,
        contentSpan: block.bodySpan,
        location: locationForSpan(resource, lines, block.span),
      });
    }
  }

  if (stack.length > 0) {
    const opening = stack[stack.length - 1]!;
    return structureError(
      "Opening fragment marker has no matching closing marker.",
      resource,
      opening.token,
      opening.name === undefined ? {} : { name: opening.name },
    );
  }

  blocks.sort((left, right) => left.span.start - right.span.start);
  declarations.sort((left, right) => left.contentSpan.start - right.contentSpan.start);

  return ok<MarkerScanResult>({ blocks, declarations });
}
