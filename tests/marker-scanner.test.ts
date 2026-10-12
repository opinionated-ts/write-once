import { isFailure, isSuccess } from "@opinionated-ts/result";
import { describe, expect, it } from "vitest";

import { scanMarkers } from "@/index";

describe("scanMarkers", () => {
  it("pairs generated blocks and preserves complete CRLF delimiter spans", () => {
    const text = [
      "before",
      '<!-- fragment source="./source.md" -->',
      "old body",
      "<!-- /fragment -->",
      "after",
      "",
    ].join("\r\n");

    const result = scanMarkers(text, { resource: "README.md" });

    expect(isSuccess(result)).toBe(true);
    if (!isSuccess(result)) return;

    expect(result.value.blocks).toHaveLength(1);
    const [block] = result.value.blocks;
    expect(block?.span).toEqual({ start: 8, end: text.indexOf("after") });
    expect(block?.bodySpan).toEqual({
      start: text.indexOf("old body"),
      end: text.indexOf("<!-- /fragment -->"),
    });
    expect(text.slice(block!.opening.lineSpan.start, block!.opening.lineSpan.end)).toBe(
      '<!-- fragment source="./source.md" -->\r\n',
    );
    expect(text.slice(block!.closing.lineSpan.start, block!.closing.lineSpan.end)).toBe(
      "<!-- /fragment -->\r\n",
    );
    expect(text.slice(block!.bodySpan.start, block!.bodySpan.end)).toBe("old body\r\n");
  });

  it("indexes nested read-only named declarations without treating them as generated", () => {
    const text = [
      '<!-- fragment name="outer" -->',
      "outer content",
      '<!-- fragment name="inner" -->',
      "inner content",
      "<!-- /fragment -->",
      "outer continues",
      "<!-- /fragment -->",
    ].join("\n");

    const result = scanMarkers(text);

    expect(isSuccess(result)).toBe(true);
    if (!isSuccess(result)) return;

    expect(result.value.declarations.map(({ name }) => name)).toEqual(["outer", "inner"]);
    expect(result.value.blocks).toHaveLength(2);
  });

  it("rejects nested generated destinations", () => {
    const result = scanMarkers(
      [
        'fragment source="./outer.md"',
        'fragment source="./inner.md"',
        "/fragment",
        "/fragment",
      ].join("\n"),
    );

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.code).toBe("MARKER_STRUCTURE_ERROR");
      expect(result.error.message).toContain("cannot be nested");
    }
  });

  it("rejects duplicate named declarations", () => {
    const result = scanMarkers(
      ['fragment name="intro"', "/fragment", 'fragment name="intro"', "/fragment"].join("\n"),
    );

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.message).toContain('Duplicate named declaration "intro"');
      expect(result.error.context?.public).toMatchObject({
        name: "intro",
        previousOffset: 0,
        previousLine: 1,
        previousColumn: 1,
        line: 3,
        column: 1,
      });
    }
  });

  it("treats declaration names as case-sensitive and preserves exact content spans", () => {
    const text = [
      'fragment name="Intro"',
      "first line",
      "second line",
      "/fragment",
      'fragment name="intro"',
      "lowercase declaration",
      "/fragment",
    ].join("\n");

    const result = scanMarkers(text);

    expect(isSuccess(result)).toBe(true);
    if (!isSuccess(result)) return;

    expect(result.value.declarations.map(({ name }) => name)).toEqual(["Intro", "intro"]);
    expect(
      result.value.declarations.map(({ contentSpan }) =>
        text.slice(contentSpan.start, contentSpan.end),
      ),
    ).toEqual(["first line\nsecond line\n", "lowercase declaration\n"]);
  });

  it.each([
    ["/fragment", "no matching opening"],
    ['fragment source="./a"', "no matching closing"],
  ])("rejects malformed structures: %s", (text, message) => {
    const result = scanMarkers(text);

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) expect(result.error.message).toContain(message);
  });

  it("preserves unrelated text and supports markers at EOF without a newline", () => {
    const text = [
      "prefix fragmentary text",
      'prefix <!-- fragment source="./source.md" --> suffix',
      "generated",
      "prefix <!-- /fragment --> suffix",
      "trailing",
    ].join("\n");

    const result = scanMarkers(text);

    expect(isSuccess(result)).toBe(true);
    if (!isSuccess(result)) return;

    const [block] = result.value.blocks;
    expect(result.value.blocks).toHaveLength(1);
    expect(text.slice(block!.span.start, block!.span.end)).toBe(
      'prefix <!-- fragment source="./source.md" --> suffix\ngenerated\nprefix <!-- /fragment --> suffix\n',
    );
  });

  it("returns an empty scan for text without marker lines", () => {
    const result = scanMarkers("ordinary text\nfragmentary is not a marker");

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.value).toEqual({ blocks: [], declarations: [] });
    }
  });
});
