import { describe, expect, it } from "vitest";

import type { ResolvedResource, SourceSelector } from "@/index";

import { namedFragmentExtractor } from "@/index";

const context = { cwd: "/project" };
const named = (name: string): SourceSelector => ({ kind: "named", name });

describe("namedFragmentExtractor", () => {
  it("extracts exact declaration body content without marker lines", () => {
    const text = [
      "before",
      '<!-- fragment name="intro" -->',
      "first line",
      "second line",
      "<!-- /fragment -->",
      "after",
    ].join("\r\n");
    const resource: ResolvedResource = {
      id: "file:source",
      location: "/project/source.md",
      text,
      metadata: { revision: "working-tree" },
    };

    const extracted = namedFragmentExtractor.extract(resource, named("intro"));

    expect(extracted.text).toBe("first line\r\nsecond line\r\n");
    expect(extracted.location).toEqual({
      resource: "/project/source.md",
      start: { line: 3, column: 1 },
      end: { line: 5, column: 1 },
    });
    expect(extracted.metadata).toMatchObject({
      revision: "working-tree",
      fragmentName: "intro",
      resourceId: "file:source",
    });
    expect(text).toContain('<!-- fragment name="intro" -->');
  });

  it("supports nested declarations and case-sensitive names", () => {
    const resource: ResolvedResource = {
      id: "file:source",
      location: "/project/source.md",
      text: [
        'fragment name="Outer"',
        "outer start",
        'fragment name="inner"',
        "inner content",
        "/fragment",
        "outer end",
        "/fragment",
      ].join("\n"),
    };

    expect(namedFragmentExtractor.extract(resource, named("inner")).text).toBe("inner content\n");
    expect(() => namedFragmentExtractor.extract(resource, named("outer"))).toThrow(
      expect.objectContaining({ code: "CONTENT_EXTRACTION_ERROR" }),
    );
  });

  it("reports missing declarations and duplicate names", () => {
    const missing: ResolvedResource = {
      id: "file:missing",
      location: "/project/missing.md",
      text: 'fragment name="present"\ncontent\n/fragment',
    };
    expect(() => namedFragmentExtractor.extract(missing, named("absent"))).toThrow(
      expect.objectContaining({ code: "CONTENT_EXTRACTION_ERROR" }),
    );

    const duplicate: ResolvedResource = {
      id: "file:duplicate",
      location: "/project/duplicate.md",
      text: 'fragment name="intro"\na\n/fragment\nfragment name="intro"\nb\n/fragment',
    };
    expect(() => namedFragmentExtractor.extract(duplicate, named("intro"))).toThrow(
      expect.objectContaining({ code: "MARKER_STRUCTURE_ERROR" }),
    );
  });

  it("only accepts named selectors and requires text", () => {
    const resource: ResolvedResource = {
      id: "file:source",
      location: "/project/source.md",
      text: "content",
    };
    expect(namedFragmentExtractor.canExtract(resource, named("intro"), context)).toBe(true);
    expect(namedFragmentExtractor.canExtract(resource, { kind: "whole" }, context)).toBe(false);

    const metadataOnly: ResolvedResource = {
      id: "custom:source",
      location: "custom://source",
      metadata: {},
    };
    expect(() => namedFragmentExtractor.extract(metadataOnly, named("intro"))).toThrow(
      expect.objectContaining({ code: "CONTENT_EXTRACTION_ERROR" }),
    );
  });
});
