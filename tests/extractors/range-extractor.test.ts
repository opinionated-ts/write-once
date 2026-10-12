import { describe, expect, it } from "vitest";

import type { ResolvedResource, SourceSelector } from "@/types";

import { rangeExtractor } from "@/extractors/range-extractor";

const context = { cwd: "/project" };
const range = (
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
): SourceSelector => ({
  kind: "range",
  range: {
    start: { line: startLine, column: startColumn },
    end: { line: endLine, column: endColumn },
  },
});

function resource(text: string): ResolvedResource {
  return { id: "file:source", location: "/project/source.txt", text };
}

describe("rangeExtractor", () => {
  it("extracts inclusive-start, exclusive-end ranges with LF and CRLF", () => {
    expect(rangeExtractor.extract(resource("alpha\nbeta\ngamma"), range(2, 2, 3, 3)).text).toBe(
      "eta\nga",
    );
    expect(rangeExtractor.extract(resource("alpha\r\nbeta"), range(1, 2, 2, 3)).text).toBe(
      "alpha\r\nbeta".slice(1, 9),
    );
  });

  it("counts columns in UTF-16 code units", () => {
    expect(rangeExtractor.extract(resource("A😀B"), range(1, 2, 1, 4)).text).toBe("😀");
  });

  it("supports empty ranges and EOF positions", () => {
    expect(rangeExtractor.extract(resource("abc"), range(1, 2, 1, 2)).text).toBe("");
    expect(rangeExtractor.extract(resource("abc"), range(1, 4, 1, 4)).text).toBe("");
    expect(rangeExtractor.extract(resource("abc\n"), range(2, 1, 2, 1)).text).toBe("");
    expect(rangeExtractor.extract(resource(""), range(1, 1, 1, 1)).text).toBe("");
  });

  it.each([
    [0, 1, 1, 1],
    [2, 1, 2, 1],
    [1, 5, 1, 5],
  ])("rejects out-of-bounds positions %j", (sl, sc, el, ec) => {
    expect(() => rangeExtractor.extract(resource("abc"), range(sl, sc, el, ec))).toThrow(
      expect.objectContaining({ code: "CONTENT_EXTRACTION_ERROR" }),
    );
  });

  it("rejects reversed ranges and resources without text", () => {
    expect(() => rangeExtractor.extract(resource("abc"), range(1, 3, 1, 2))).toThrow(
      expect.objectContaining({ code: "CONTENT_EXTRACTION_ERROR" }),
    );

    const metadataOnly: ResolvedResource = {
      id: "custom:source",
      location: "custom://source",
      metadata: {},
    };
    expect(() => rangeExtractor.extract(metadataOnly, range(1, 1, 1, 1))).toThrow(
      expect.objectContaining({ code: "CONTENT_EXTRACTION_ERROR" }),
    );
  });

  it("only accepts range selectors and returns source metadata", () => {
    expect(rangeExtractor.canExtract(resource("abc"), range(1, 1, 1, 2), context)).toBe(true);
    expect(rangeExtractor.canExtract(resource("abc"), { kind: "whole" }, context)).toBe(false);

    const selected = rangeExtractor.extract(resource("abc"), range(1, 1, 1, 2));
    expect(selected.metadata?.resourceLocation).toBe("/project/source.txt");
    expect(selected.location?.start).toEqual({ line: 1, column: 1 });
  });
});
