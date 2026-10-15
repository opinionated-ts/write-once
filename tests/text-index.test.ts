import { describe, expect, it } from "vitest";

import { coordinateAt, coordinateAtOffset, getTextLines } from "@/text-index";

describe("text index primitives", () => {
  it("splits LF, CRLF, and lone-CR lines without changing offsets", () => {
    const text = "a\r\n😀b\rc\n";

    expect(getTextLines(text)).toEqual([
      { text: "a", start: 0, contentEnd: 1, end: 3, number: 1 },
      { text: "😀b", start: 3, contentEnd: 6, end: 7, number: 2 },
      { text: "c", start: 7, contentEnd: 8, end: 9, number: 3 },
      { text: "", start: 9, contentEnd: 9, end: 9, number: 4 },
    ]);
  });

  it("matches direct coordinate calculation for every offset around mixed line endings", () => {
    const text = "a\r\n😀b\rc\n";
    const lines = getTextLines(text);

    for (let offset = 0; offset <= text.length; offset += 1) {
      expect(coordinateAtOffset(lines, offset)).toEqual(coordinateAt(text, offset));
    }
  });

  it("uses one-based lines and UTF-16 columns", () => {
    const text = "a\r\n😀b\rc\n";

    expect(coordinateAt(text, 0)).toEqual({ line: 1, column: 1 });
    expect(coordinateAt(text, 3)).toEqual({ line: 2, column: 1 });
    expect(coordinateAt(text, 5)).toEqual({ line: 2, column: 3 });
    expect(coordinateAt(text, 7)).toEqual({ line: 3, column: 1 });
    expect(coordinateAt(text, text.length)).toEqual({ line: 4, column: 1 });
    expect(getTextLines("")).toEqual([{ text: "", start: 0, contentEnd: 0, end: 0, number: 1 }]);
  });
});
