import { isFailure, isSuccess } from "@opinionated-ts/result";
import { describe, expect, it } from "vitest";

import { parseMarkerLine } from "@/index";

describe("parseMarkerLine", () => {
  it("ignores host-language wrappers and unrelated attributes", () => {
    const result = parseMarkerLine('<!-- fragment source="./source.md" custom="ignored" -->', {
      resource: "README.md",
      offset: 100,
      line: 4,
    });

    expect(isSuccess(result)).toBe(true);
    if (!isSuccess(result)) return;

    expect(result.value?.kind).toBe("open");
    expect(result.value?.attributes).toEqual({ source: "./source.md" });
    expect(result.value?.span.start).toBe(105);
    expect(result.value?.location.start).toEqual({ line: 4, column: 6 });
    expect(result.value?.lineSpan).toEqual({ start: 100, end: 155 });
  });

  it("recognizes read-only named declarations and closing markers", () => {
    const declaration = parseMarkerLine('# fragment name="intro"');
    const closing = parseMarkerLine("<!-- /fragment -->");
    const invalidClosing = parseMarkerLine('/fragment source="./source.md"');

    expect(isSuccess(declaration)).toBe(true);
    expect(isSuccess(closing)).toBe(true);
    expect(isFailure(invalidClosing)).toBe(true);
    if (!isSuccess(declaration) || !isSuccess(closing)) return;

    expect(declaration.value?.attributes).toEqual({ name: "intro" });
    expect(closing.value?.kind).toBe("close");
    expect(closing.value?.attributes).toEqual({});
  });

  it("parses a source range suffix from the right, preserving drive letters", () => {
    const result = parseMarkerLine('fragment source="C:\\docs\\source.ts:10:20-15:50"');

    expect(isSuccess(result)).toBe(true);
    if (!isSuccess(result)) return;

    expect(result.value?.attributes).toEqual({
      source: "C:\\docs\\source.ts",
      range: "10:20-15:50",
    });
  });

  it("gives an explicit range precedence over a source suffix", () => {
    const result = parseMarkerLine('fragment source="./source.ts:10:20-15:50" range="1:1-2:1"');

    expect(isSuccess(result)).toBe(true);
    if (!isSuccess(result)) return;

    expect(result.value?.attributes).toEqual({
      source: "./source.ts",
      range: "1:1-2:1",
    });
  });

  it("rejects duplicate recognized attributes and malformed quoting", () => {
    const duplicate = parseMarkerLine('fragment source="./a" source="./b"');
    const malformed = parseMarkerLine('fragment name="unfinished');

    expect(isFailure(duplicate)).toBe(true);
    expect(isFailure(malformed)).toBe(true);
    if (!isFailure(duplicate) || !isFailure(malformed)) return;

    expect(duplicate.error.code).toBe("MARKER_SYNTAX_ERROR");
    expect(duplicate.error.context?.public).toMatchObject({ attribute: "source" });
    expect(malformed.error.message).toContain("Unterminated quoted value");
  });

  it("rejects incompatible selectors and invalid ranges", () => {
    const combined = parseMarkerLine('fragment source="./a" name="intro" range="1:1-2:1"');
    const invalidRange = parseMarkerLine('fragment source="./a" range="3:1-2:1"');

    expect(isFailure(combined)).toBe(true);
    expect(isFailure(invalidRange)).toBe(true);
  });

  it("does not treat marker-like text inside attribute values as another marker", () => {
    const result = parseMarkerLine('fragment source="folder with fragment name.md"');

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.value?.attributes.source).toBe("folder with fragment name.md");
    }
  });

  it("reports the exact recognized attribute offset and requires a source for ranges", () => {
    const malformed = parseMarkerLine('fragment source="./a" range="3:1-2:1"', {
      offset: 20,
      line: 2,
    });
    const missingSource = parseMarkerLine('fragment range="1:1-2:1"');

    expect(isFailure(malformed)).toBe(true);
    expect(isFailure(missingSource)).toBe(true);
    if (!isFailure(malformed) || !isFailure(missingSource)) return;

    expect(malformed.error.context?.public).toMatchObject({
      line: 2,
      column: 23,
      offset: 42,
      attribute: "range",
    });
    expect(missingSource.error.message).toContain('requires a "source"');
  });

  it("returns undefined when a line contains no marker", () => {
    const result = parseMarkerLine("ordinary text without a marker token");

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) expect(result.value).toBeUndefined();
  });
});
