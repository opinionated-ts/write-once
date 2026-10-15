import { describe, expect, it } from "vitest";

import type { ResolvedContent } from "@/types";

import { createSourceIndexCache } from "@/source-index-cache";

function resource(text: string): ResolvedContent {
  return {
    root: "/project",
    path: "source.md",
    id: "file:/project/source.md",
    location: "/project/source.md",
    text,
  };
}

describe("source index cache", () => {
  it("reuses marker and line indexes for a source during one run", () => {
    const cache = createSourceIndexCache();
    const source = resource('fragment name="first"\nalpha\n/fragment');

    const markers = cache.scanMarkers(source);
    const lines = cache.getTextLines(source);
    expect(cache.scanMarkers(source)).toBe(markers);
    expect(cache.getTextLines(source)).toBe(lines);

    cache.clear();

    expect(cache.scanMarkers(source)).not.toBe(markers);
    expect(cache.getTextLines(source)).not.toBe(lines);
  });
});
