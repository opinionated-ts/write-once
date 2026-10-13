import { describe, expect, it } from "vitest";

import type { Diagnostic } from "@/types";

import { formatDiagnostic } from "@/diagnostics";

function stripAnsi(value: string) {
  return value.replace(new RegExp(String.fromCharCode(27) + "\\[[0-?]*[ -/]*[@-~]", "g"), "");
}

describe("formatDiagnostic", () => {
  it("includes severity, stage, message, file location, and source", () => {
    const diagnostic: Diagnostic = {
      severity: "error",
      stage: "resolve",
      message: "Could not resolve source.",
      file: "/project/README.md",
      source: "./missing.md",
      markerLocation: {
        resource: "/project/README.md",
        start: { line: 4, column: 8 },
        end: { line: 4, column: 16 },
      },
    };

    const output = stripAnsi(formatDiagnostic(diagnostic));

    expect(output).toContain("error[resolve]: Could not resolve source.");
    expect(output).toContain("/project/README.md:4:8");
    expect(output).toContain("source: ./missing.md");
  });

  it("omits source coordinates when only a file is available", () => {
    const output = stripAnsi(
      formatDiagnostic({
        severity: "info",
        stage: "prepare",
        message: "Resources prepared.",
        file: "/project/README.md",
      }),
    );

    expect(output).toBe("info[prepare]: Resources prepared.\n  --> /project/README.md");
  });

  it("renders warnings with a warn severity label", () => {
    const output = stripAnsi(
      formatDiagnostic({
        severity: "warning",
        stage: "discovery",
        message: "No destination files matched.",
      }),
    );

    expect(output).toBe("warn[discovery]: No destination files matched.");
  });
});
