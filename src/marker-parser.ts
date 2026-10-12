import { error, ok } from "@opinionated-ts/result";

import type { MarkerAttributes, MarkerToken, TextCoordinate } from "./types.js";

import { MarkerSyntaxError } from "./errors/marker-syntax-error.js";

export interface ParseMarkerLineOptions {
  resource?: string;
  offset?: number;
  line?: number;
}

interface ParsedAttribute {
  name: string;
  value?: string;
  start: number;
  end: number;
}

const ATTRIBUTE_NAME = /^[A-Za-z_][A-Za-z0-9_-]*/;
const RANGE = /^(\d+):(\d+)-(\d+):(\d+)$/;
const SOURCE_SUFFIX = /:(\d+):(\d+)-(\d+):(\d+)$/;
const SEMANTIC_ATTRIBUTES = new Set(["source", "name", "range"]);

function isWord(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_-]/.test(character);
}

function findMarker(line: string) {
  const found: Array<{ kind: "open" | "close"; start: number; end: number }> = [];

  let firstMarkerEnd = -1;
  let quote: string | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (firstMarkerEnd >= 0) {
      if (quote !== undefined) {
        if (character === quote) quote = undefined;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
    }

    const previous = line[index - 1];

    if (line.startsWith("/fragment", index)) {
      const end = index + 9;
      if (!isWord(previous) && !isWord(line[end])) {
        found.push({ kind: "close", start: index, end });
        firstMarkerEnd = end;
        index = end - 1;
        continue;
      }
    }

    if (line.startsWith("fragment", index)) {
      const end = index + 8;
      if (previous !== "/" && !isWord(previous) && !isWord(line[end])) {
        found.push({ kind: "open", start: index, end });
        firstMarkerEnd = end;
        index = end - 1;
      }
    }
  }

  if (found.length > 1) {
    return { kind: "open" as const, start: -1, end: -1 };
  }

  return found[0];
}

function parseAttributes(line: string, start: number) {
  const attributes: ParsedAttribute[] = [];
  let cursor = start;
  let tokenEnd = start;

  while (cursor < line.length) {
    while (cursor < line.length && /\s/.test(line[cursor]!)) cursor += 1;
    if (
      cursor >= line.length ||
      line.startsWith("-->", cursor) ||
      line.startsWith("*/", cursor) ||
      line[cursor] === ">"
    )
      break;

    const match = ATTRIBUTE_NAME.exec(line.slice(cursor));
    if (!match) break;

    const attributeStart = cursor;
    const name = match[0];
    cursor += name.length;
    while (cursor < line.length && /\s/.test(line[cursor]!)) cursor += 1;

    if (line[cursor] !== "=") {
      attributes.push({ name, start: attributeStart, end: cursor });
      tokenEnd = cursor;
      continue;
    }

    cursor += 1;
    while (cursor < line.length && /\s/.test(line[cursor]!)) cursor += 1;
    if (cursor >= line.length) {
      return {
        attributes,
        end: cursor,
        error: "Missing value for attribute " + name + ".",
        errorOffset: attributeStart,
      };
    }

    const quote = line[cursor];
    let value: string;

    if (quote === '"' || quote === "'") {
      cursor += 1;
      const valueStart = cursor;
      while (cursor < line.length && line[cursor] !== quote) cursor += 1;
      if (cursor >= line.length) {
        return {
          attributes,
          end: cursor,
          error: "Unterminated quoted value for attribute " + name + ".",
          errorOffset: attributeStart,
        };
      }
      value = line.slice(valueStart, cursor);
      cursor += 1;
    } else {
      const valueStart = cursor;
      while (cursor < line.length && !/\s/.test(line[cursor]!) && line[cursor] !== ">") cursor += 1;
      value = line.slice(valueStart, cursor);
    }

    attributes.push({ name, value, start: attributeStart, end: cursor });
    tokenEnd = cursor;
  }

  return { attributes, end: tokenEnd };
}

function validRange(value: string): boolean {
  const match = RANGE.exec(value);
  if (!match) return false;

  const [, sl, sc, el, ec] = match;
  const startLine = Number(sl);
  const startColumn = Number(sc);
  const endLine = Number(el);
  const endColumn = Number(ec);

  return (
    [startLine, startColumn, endLine, endColumn].every(
      (part) => Number.isSafeInteger(part) && part > 0,
    ) &&
    (startLine < endLine || (startLine === endLine && startColumn <= endColumn))
  );
}

function makeSyntaxError(
  message: string,
  details: { resource: string; line: number; column: number; offset: number; attribute?: string },
) {
  return error(
    MarkerSyntaxError({
      message,
      context: {
        public: {
          resource: details.resource,
          line: details.line,
          column: details.column,
          offset: details.offset,
          ...(details.attribute === undefined ? {} : { attribute: details.attribute }),
        },
      },
    }),
  );
}

/**
 * Parse one line for a language-agnostic fragment marker.
 * Host-language comments and wrapper syntax are treated as opaque text.
 * Offsets and columns use UTF-16 code units; line and column coordinates are 1-based.
 * A line without a marker succeeds with undefined.
 */
export function parseMarkerLine(lineText: string, options: ParseMarkerLineOptions = {}) {
  const resource = options.resource ?? "<input>";
  const offset = options.offset ?? 0;
  const line = options.line ?? 1;
  const marker = findMarker(lineText);

  if (!marker) return ok(undefined);
  if (marker.start < 0) {
    return makeSyntaxError("A line cannot contain multiple fragment markers.", {
      resource,
      line,
      column: 1,
      offset,
    });
  }

  const parsed = parseAttributes(lineText, marker.end);

  if (parsed.error) {
    return makeSyntaxError(parsed.error, {
      resource,
      line,
      column: (parsed.errorOffset ?? marker.start) + 1,
      offset: offset + (parsed.errorOffset ?? marker.start),
    });
  }

  const recognized = new Map<string, ParsedAttribute>();
  for (const attribute of parsed.attributes) {
    if (!SEMANTIC_ATTRIBUTES.has(attribute.name)) continue;

    if (recognized.has(attribute.name)) {
      return makeSyntaxError("Duplicate " + attribute.name + " attribute.", {
        resource,
        line,
        column: attribute.start + 1,
        offset: offset + attribute.start,
        attribute: attribute.name,
      });
    }

    if (attribute.value === undefined || attribute.value.length === 0) {
      return makeSyntaxError("Attribute " + attribute.name + " requires a non-empty value.", {
        resource,
        line,
        column: attribute.start + 1,
        offset: offset + attribute.start,
        attribute: attribute.name,
      });
    }

    recognized.set(attribute.name, attribute);
  }

  const attributes: MarkerAttributes = {};
  for (const name of ["source", "name", "range"] as const) {
    const attribute = recognized.get(name);
    if (attribute?.value !== undefined) attributes[name] = attribute.value;
  }

  if (marker.kind === "close" && recognized.size > 0) {
    return makeSyntaxError("Closing fragment markers cannot have semantic attributes.", {
      resource,
      line,
      column: marker.start + 1,
      offset: offset + marker.start,
    });
  }

  if (attributes.name !== undefined && attributes.range !== undefined) {
    const conflict = recognized.get("range")!;
    return makeSyntaxError('Attributes "name" and "range" cannot be combined.', {
      resource,
      line,
      column: conflict.start + 1,
      offset: offset + conflict.start,
      attribute: "range",
    });
  }

  if (attributes.range !== undefined && !validRange(attributes.range)) {
    return makeSyntaxError(
      'Attribute "range" must use positive, ordered line and column coordinates.',
      {
        resource,
        line,
        column: recognized.get("range")!.start + 1,
        offset: offset + recognized.get("range")!.start,
        attribute: "range",
      },
    );
  }

  if (attributes.range !== undefined && attributes.source === undefined) {
    return makeSyntaxError('Attribute "range" requires a "source" attribute.', {
      resource,
      line,
      column: recognized.get("range")!.start + 1,
      offset: offset + recognized.get("range")!.start,
      attribute: "range",
    });
  }

  if (marker.kind === "open" && attributes.source !== undefined) {
    const suffix = SOURCE_SUFFIX.exec(attributes.source);
    if (suffix) {
      const suffixRange = suffix[1] + ":" + suffix[2] + "-" + suffix[3] + ":" + suffix[4];
      if (!validRange(suffixRange)) {
        return makeSyntaxError("The source range suffix must use positive, ordered coordinates.", {
          resource,
          line,
          column: recognized.get("source")!.start + 1,
          offset: offset + recognized.get("source")!.start,
          attribute: "source",
        });
      }
      if (attributes.range === undefined) attributes.range = suffixRange;
      attributes.source = attributes.source.slice(0, -suffix[0].length);
      if (attributes.source.length === 0) {
        return makeSyntaxError("Source must include a resource path before its range suffix.", {
          resource,
          line,
          column: recognized.get("source")!.start + 1,
          offset: offset + recognized.get("source")!.start,
          attribute: "source",
        });
      }
    }
  }

  if (attributes.name !== undefined && attributes.range !== undefined) {
    const conflict = recognized.get("range")!;
    return makeSyntaxError('Attributes "name" and an effective range cannot be combined.', {
      resource,
      line,
      column: conflict.start + 1,
      offset: offset + conflict.start,
      attribute: "range",
    });
  }

  const tokenEnd = Math.max(marker.end, parsed.end);
  const location = {
    resource,
    start: { line, column: marker.start + 1 } satisfies TextCoordinate,
    end: { line, column: tokenEnd + 1 } satisfies TextCoordinate,
  };

  return ok<MarkerToken | undefined>({
    kind: marker.kind,
    raw: lineText.slice(marker.start, tokenEnd),
    attributes,
    span: { start: offset + marker.start, end: offset + tokenEnd },
    lineSpan: { start: offset, end: offset + lineText.length },
    location,
  });
}
