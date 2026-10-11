import { describe, expect, it } from "vitest";

import { greet } from "@/index";

describe("greet", () => {
  it("returns a greeting for the provided name", () => {
    expect(greet("TypeScript")).toBe("Hello, TypeScript!");
  });
});
