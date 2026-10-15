import { isFailure, isSuccess } from "@opinionated-ts/result";
import { describe, expect, it } from "vitest";

import type { ResolvedContent, SourceSelector } from "@/types";

import { namedFragmentExtractor } from "@/extractors/named-fragment-extractor";

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
    const resource: ResolvedContent = {
      root: "/project",
      path: "source.md",
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
    const resource: ResolvedContent = {
      root: "/project",
      path: "source.md",
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
    const missing: ResolvedContent = {
      root: "/project",
      path: "missing.md",
      id: "file:missing",
      location: "/project/missing.md",
      text: ['fragment name="present"', "content", "/fragment"].join("\n"),
    };
    expect(() => namedFragmentExtractor.extract(missing, named("absent"))).toThrow(
      expect.objectContaining({ code: "CONTENT_EXTRACTION_ERROR" }),
    );

    const duplicate: ResolvedContent = {
      root: "/project",
      path: "duplicate.md",
      id: "file:duplicate",
      location: "/project/duplicate.md",
      text: 'fragment name="intro"\na\n/fragment\nfragment name="intro"\nb\n/fragment',
    };
    expect(() => namedFragmentExtractor.extract(duplicate, named("intro"))).toThrow(
      expect.objectContaining({ code: "MARKER_STRUCTURE_ERROR" }),
    );
  });

  it("rejects a non-named selector and runtime resources without text", () => {
    const resource: ResolvedContent = {
      root: "/project",
      path: "source.md",
      id: "file:source",
      location: "/project/source.md",
      text: "content",
    };
    const missingText = { ...resource };
    Object.defineProperty(missingText, "text", { value: undefined });

    expect(() => namedFragmentExtractor.extract(resource, { kind: "whole" })).toThrow(
      expect.objectContaining({
        message: "The named-fragment extractor requires a named selector.",
      }),
    );
    expect(() => namedFragmentExtractor.extract(missingText, named("intro"))).toThrow(
      expect.objectContaining({ message: expect.stringContaining("does not provide text") }),
    );
  });

  it("exposes typed extraction failures through its Result contract", () => {
    const resource: ResolvedContent = {
      root: "/project",
      path: "missing.md",
      id: "file:missing",
      location: "/project/missing.md",
      text: ['fragment name="present"', "content", "/fragment"].join("\n"),
    };

    const failed = namedFragmentExtractor.extractResult(resource, named("absent"));
    expect(isFailure(failed)).toBe(true);
    if (isFailure(failed)) {
      expect(failed.error).toMatchObject({ code: "CONTENT_EXTRACTION_ERROR" });
    }

    const succeeded = namedFragmentExtractor.extractResult(resource, named("present"));
    expect(isSuccess(succeeded)).toBe(true);
    if (isSuccess(succeeded)) expect(succeeded.value.text).toBe("content\n");
  });

  it("only accepts named selectors and requires text", () => {
    const resource: ResolvedContent = {
      root: "/project",
      path: "source.md",
      id: "file:source",
      location: "/project/source.md",
      text: "content",
    };
    expect(namedFragmentExtractor.canExtract(resource, named("intro"), context)).toBe(true);
    expect(namedFragmentExtractor.canExtract(resource, { kind: "whole" }, context)).toBe(false);
  });
});
