import { isFailure } from "@opinionated-ts/result";
import { describe, expect, it } from "vitest";

import { parseMarkerLine } from "@/marker-parser";

describe("multiple markers on one line", () => {
  it("rejects multiple marker tokens instead of choosing one ambiguously", () => {
    const result = parseMarkerLine('<!-- fragment source="./a" --> <!-- /fragment -->');

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.code).toBe("MARKER_SYNTAX_ERROR");
      expect(result.error.message).toContain("multiple fragment markers");
    }
  });
});
