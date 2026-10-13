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

export interface ScanMarkersOptions {
  /** Identifier included in diagnostics. Defaults to "<input>". */
  resource?: string;
}

export interface MarkerScanResult {
  blocks: MarkerBlock[];
  declarations: NamedDeclaration[];
}

interface LineRecord {
  text: string;
  start: number;
  contentEnd: number;
  end: number;
  number: number;
}

interface OpenMarker {
  token: MarkerToken;
  isGenerated: boolean;
  name?: string;
  declarationParent?: string;
}

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
    if (text[end] === "\r" && text[end + 1] === "\n") {
      end += 2;
    } else if (text[end] === "\r" || text[end] === "\n") {
      end += 1;
    }

    lines.push({
      text: text.slice(start, contentEnd),
      start,
      contentEnd,
      end,
      number,
    });
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

function locationForSpan(resource: string, text: string, span: TextSpan): SourceLocation {
  const coordinateAt = (offset: number) => {
    let line = 1;
    let lineStart = 0;

    for (let index = 0; index < offset; index += 1) {
      if (text[index] === "\r") {
        if (text[index + 1] === "\n") index += 1;
        line += 1;
        lineStart = index + 1;
      } else if (text[index] === "\n") {
        line += 1;
        lineStart = index + 1;
      }
    }

    return { line, column: offset - lineStart + 1 };
  };

  return {
    resource,
    start: coordinateAt(span.start),
    end: coordinateAt(span.end),
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

/**
 * Scans marker lines and pairs blocks without reading files or interpreting
 * host-language syntax. Delimiter lines are retained verbatim in their spans.
 */
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

  const lines = getLines(suppression.text);

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

    const openingLine = lines.find((candidate) => candidate.start === opening.token.lineSpan.start);
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
        location: locationForSpan(resource, text, block.span),
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
