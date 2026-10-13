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
    const bareMarker = parseMarkerLine("fragment");
    const rangeOnly = parseMarkerLine('fragment range="1:1-2:1"');

    expect(isFailure(duplicate)).toBe(true);
    expect(isSuccess(malformed)).toBe(true);
    expect(isSuccess(wordOnly)).toBe(true);
    expect(isSuccess(bareMarker)).toBe(true);
    expect(isFailure(rangeOnly)).toBe(true);
    if (
      !isFailure(duplicate) ||
      !isSuccess(malformed) ||
      !isSuccess(wordOnly) ||
      !isSuccess(bareMarker)
    )
      return;
    if (isFailure(rangeOnly)) {
      expect(rangeOnly.error.message).toContain('requires a "source" attribute');
    }

    expect(duplicate.error.code).toBe("MARKER_SYNTAX_ERROR");
    expect(duplicate.error.context?.public).toMatchObject({ attribute: "source" });
    expect(malformed.value).toBeUndefined();
    expect(wordOnly.value).toBeUndefined();
    expect(bareMarker.value).toBeUndefined();
  });

  it("rejects incompatible selectors and invalid ranges", () => {
    const combined = parseMarkerLine('fragment source="./a" name="intro" range="1:1-2:1"');
    const invalidRange = parseMarkerLine('fragment source="./a" range="3:1-2:1"');
    const malformedRange = parseMarkerLine('fragment source="./a" range="not-a-range"');
    const namedSuffixRange = parseMarkerLine('fragment source="./a:1:1-2:1" name="intro"');

    expect(isFailure(combined)).toBe(true);
    expect(isFailure(invalidRange)).toBe(true);
    expect(isFailure(malformedRange)).toBe(true);
    expect(isFailure(namedSuffixRange)).toBe(true);
    if (isFailure(malformedRange))
      expect(malformedRange.error.message).toContain(
        "positive, ordered line and column coordinates",
      );
    if (isFailure(namedSuffixRange))
      expect(namedSuffixRange.error.message).toContain("effective range");
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

    expect(missingSource.error.message).toContain('requires a "source" attribute');
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

  it("parses single-quoted values and stops at host-language comment terminators", () => {
    const singleQuoted = parseMarkerLine(`fragment source="./source.md" name='intro' -->`);
    const blockComment = parseMarkerLine('fragment source="./source.md" */');

    expect(isSuccess(singleQuoted)).toBe(true);
    expect(isSuccess(blockComment)).toBe(true);
    if (isSuccess(singleQuoted)) {
      expect(singleQuoted.value?.attributes).toEqual({ source: "./source.md", name: "intro" });
    }
    if (isSuccess(blockComment)) expect(blockComment.value?.attributes.source).toBe("./source.md");
  });

  it("reports missing attribute values and rejects semantic attributes on closing markers", () => {
    const missingValue = parseMarkerLine('fragment name="intro" source=');
    const semanticClosing = parseMarkerLine('/fragment source="./source.md"');

    expect(isFailure(missingValue)).toBe(true);
    expect(isSuccess(semanticClosing)).toBe(true);
    if (isFailure(missingValue)) expect(missingValue.error.message).toContain("Missing value");
    if (isSuccess(semanticClosing)) expect(semanticClosing.value).toBeUndefined();
  });

  it("rejects conflicting names and ranges, invalid suffix ranges, and suffixes without a path", () => {
    const selectorConflict = parseMarkerLine('fragment source="./a" name="intro" range="1:1-2:1"');
    const invalidSuffix = parseMarkerLine('fragment source="./a:3:1-2:1"');
    const emptyPathSuffix = parseMarkerLine('fragment source=":1:1-2:1"');
    const suffixConflict = parseMarkerLine('fragment source="./a:1:1-2:1" range="3:1-4:1"');

    expect(isFailure(selectorConflict)).toBe(true);
    expect(isFailure(invalidSuffix)).toBe(true);
    expect(isFailure(emptyPathSuffix)).toBe(true);
    expect(isSuccess(suffixConflict)).toBe(true);
    if (isFailure(selectorConflict))
      expect(selectorConflict.error.message).toContain("cannot be combined");
    if (isFailure(invalidSuffix))
      expect(invalidSuffix.error.message).toContain("source range suffix");
    if (isFailure(emptyPathSuffix))
      expect(emptyPathSuffix.error.message).toContain("resource path");
    if (isSuccess(suffixConflict)) {
      expect(suffixConflict.value?.attributes).toEqual({ source: "./a", range: "3:1-4:1" });
    }
  });

  it("detects multiple markers while ignoring marker-like word boundaries and quoted text", () => {
    const multiple = parseMarkerLine('fragment source="./a" /fragment fragment name="b"');
    const embedded = parseMarkerLine('fragmented source="./a" and /fragmented');
    const quoted = parseMarkerLine('fragment source="./folder/fragment name.md"');

    expect(isFailure(multiple)).toBe(true);
    expect(isSuccess(embedded)).toBe(true);
    expect(isSuccess(quoted)).toBe(true);
    if (isSuccess(embedded)) expect(embedded.value).toBeUndefined();
    if (isSuccess(quoted))
      expect(quoted.value?.attributes.source).toBe("./folder/fragment name.md");
  });

  it("ignores malformed unrelated attributes while validating recognized attributes", () => {
    const attributeWithoutValue = parseMarkerLine('fragment source="./source.md" custom');
    const unquotedCustomValue = parseMarkerLine('fragment source="./source.md" custom=value');
    const unterminatedCustomValue = parseMarkerLine(
      'fragment source="./source.md" custom="unfinished',
    );
    const invalidAttributeToken = parseMarkerLine('fragment source="./source.md" @@@');

    for (const result of [attributeWithoutValue, unquotedCustomValue, invalidAttributeToken]) {
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) expect(result.value?.attributes.source).toBe("./source.md");
    }
    expect(isFailure(unterminatedCustomValue)).toBe(true);
    if (isFailure(unterminatedCustomValue)) {
      expect(unterminatedCustomValue.error.message).toContain("Unterminated quoted value");
    }
  });

  it("returns undefined when a line contains no marker", () => {
    const result = parseMarkerLine("ordinary text without a marker token");

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) expect(result.value).toBeUndefined();
  });
});
