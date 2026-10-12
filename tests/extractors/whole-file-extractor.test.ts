import { describe, expect, it } from "vitest";

import type { ResolvedResource, SourceSelector } from "@/index";

import { wholeFileExtractor } from "@/index";

const whole: SourceSelector = { kind: "whole" };
const context = { cwd: "/project" };

describe("wholeFileExtractor", () => {
  it.each(["", "content", "line one\nline two\n", "line one\r\nline two", "😀\n"])(
    "preserves source text exactly: %j",
    (text) => {
      const resource: ResolvedResource = {
        id: "local:source",
        location: "/project/source.md",
        text,
        metadata: { revision: "working-tree" },
      };

      const extracted = wholeFileExtractor.extract(resource, whole);

      expect(extracted.text).toBe(text);
      expect(extracted.metadata).toMatchObject({
        revision: "working-tree",
        resourceId: "local:source",
        resourceLocation: "/project/source.md",
      });
      expect(extracted.location?.start).toEqual({ line: 1, column: 1 });
    },
  );

  it("records end coordinates without normalizing newline styles", () => {
    const resource: ResolvedResource = {
      id: "local:source",
      location: "/project/source.md",
      text: "one\r\ntwo\n",
    };

    expect(wholeFileExtractor.extract(resource, whole).location?.end).toEqual({
      line: 3,
      column: 1,
    });
  });

  it("only accepts whole-source selectors", () => {
    expect(
      wholeFileExtractor.canExtract(
        { id: "local:source", location: "/project/source.md", text: "content" },
        whole,
        context,
      ),
    ).toBe(true);
    expect(
      wholeFileExtractor.canExtract(
        { id: "local:source", location: "/project/source.md", text: "content" },
        { kind: "named", name: "intro" },
        context,
      ),
    ).toBe(false);
  });

  it("reports metadata-only resources as extraction errors", () => {
    const resource: ResolvedResource = {
      id: "custom:source",
      location: "custom://source",
      metadata: { token: "value" },
    };

    expect(() => wholeFileExtractor.extract(resource, whole)).toThrow(
      expect.objectContaining({ code: "CONTENT_EXTRACTION_ERROR" }),
    );
  });
});
