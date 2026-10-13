import { describe, expect, it } from "vitest";

import type { ResolvedContent, SourceSelector } from "@/types";

import { wholeFileExtractor } from "@/extractors/whole-file-extractor";

const whole: SourceSelector = { kind: "whole" };
const context = { cwd: "/project" };

describe("wholeFileExtractor", () => {
  it.each(["", "content", "line one\nline two\n", "line one\r\nline two", "😀\n"])(
    "preserves source text exactly: %j",
    (text) => {
      const resource: ResolvedContent = {
        root: "/project",
        path: "source.md",
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
    const resource: ResolvedContent = {
      root: "/project",
      path: "source.md",
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
        {
          root: "/project",
          path: "source.md",
          id: "local:source",
          location: "/project/source.md",
          text: "content",
        },
        whole,
        context,
      ),
    ).toBe(true);
    expect(
      wholeFileExtractor.canExtract(
        {
          root: "/project",
          path: "source.md",
          id: "local:source",
          location: "/project/source.md",
          text: "content",
        },
        { kind: "named", name: "intro" },
        context,
      ),
    ).toBe(false);
  });
});
