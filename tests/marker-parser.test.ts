import { isFailure, isSuccess } from "@opinionated-ts/result";
import { describe, expect, it } from "vitest";

import { parseMarkerLine } from "@/marker-parser";

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
    expect(isSuccess(invalidClosing)).toBe(true);
    if (!isSuccess(declaration) || !isSuccess(closing) || !isSuccess(invalidClosing)) return;
    expect(invalidClosing.value).toBeUndefined();

    expect(declaration.value?.attributes).toEqual({ name: "intro" });
    expect(closing.value?.kind).toBe("close");
    expect(closing.value?.attributes).toEqual({});
  });

  it("ignores closing tokens with attributes because only bare /fragment closes", () => {
    const result = parseMarkerLine('/fragment source="./source.md"');

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) expect(result.value).toBeUndefined();
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
    const wordOnly = parseMarkerLine("The word fragment appears here");
    const rangeOnly = parseMarkerLine('fragment range="1:1-2:1"');

    expect(isFailure(duplicate)).toBe(true);
    expect(isSuccess(malformed)).toBe(true);
    expect(isSuccess(wordOnly)).toBe(true);
    expect(isSuccess(rangeOnly)).toBe(true);
    if (
      !isFailure(duplicate) ||
      !isSuccess(malformed) ||
      !isSuccess(wordOnly) ||
      !isSuccess(rangeOnly)
    )
      return;

    expect(duplicate.error.code).toBe("MARKER_SYNTAX_ERROR");
    expect(duplicate.error.context?.public).toMatchObject({ attribute: "source" });
    expect(malformed.value).toBeUndefined();
    expect(wordOnly.value).toBeUndefined();
    expect(rangeOnly.value).toBeUndefined();
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
    expect(isSuccess(missingSource)).toBe(true);
    if (!isFailure(malformed) || !isSuccess(missingSource)) return;

    expect(missingSource.value).toBeUndefined();
    expect(malformed.error.context?.public).toMatchObject({
      line: 2,
      column: 23,
      offset: 42,
      attribute: "range",
    });
  });

  it("rejects empty semantic values, unquoted values, and duplicate selector attributes", () => {
    const emptySource = parseMarkerLine('fragment source=""');
    const unquotedSource = parseMarkerLine("fragment source=./source.md");
    const duplicateName = parseMarkerLine('fragment name="one" name="two"');
    const duplicateRange = parseMarkerLine('fragment source="./a" range="1:1-1:2" range="2:1-2:2"');
    const unsafeRange = parseMarkerLine('fragment source="./a" range="1:1-9007199254740992:1"');

    expect(isFailure(emptySource)).toBe(true);
    expect(isSuccess(unquotedSource)).toBe(true);
    expect(isFailure(duplicateName)).toBe(true);
    expect(isFailure(duplicateRange)).toBe(true);
    expect(isFailure(unsafeRange)).toBe(true);
    if (isSuccess(unquotedSource)) expect(unquotedSource.value).toBeUndefined();
    if (isFailure(emptySource))
      expect(emptySource.error.context?.public).toMatchObject({ attribute: "source" });
    if (isFailure(duplicateName))
      expect(duplicateName.error.context?.public).toMatchObject({ attribute: "name" });
    if (isFailure(duplicateRange))
      expect(duplicateRange.error.context?.public).toMatchObject({ attribute: "range" });
  });

  it("returns undefined when a line contains no marker", () => {
    const result = parseMarkerLine("ordinary text without a marker token");

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) expect(result.value).toBeUndefined();
  });
});
