import pc from "picocolors";

import type { Diagnostic } from "./types.js";

/** Render one diagnostic in a concise, linter-style format. */
export function formatDiagnostic(diagnostic: Diagnostic): string {
  const label = diagnostic.severity === "warning" ? "warn" : diagnostic.severity;
  const styledLabel =
    diagnostic.severity === "error"
      ? pc.red(label)
      : diagnostic.severity === "warning"
        ? pc.yellow(label)
        : pc.cyan(label);
  const lines = [`${styledLabel}[${diagnostic.stage}]: ${diagnostic.message}`];

  if (diagnostic.file !== undefined) {
    const location = diagnostic.markerLocation;
    lines.push(
      `  --> ${diagnostic.file}${location === undefined ? "" : `:${location.start.line}:${location.start.column}`}`,
    );
  }
  if (diagnostic.source !== undefined) lines.push(`  source: ${diagnostic.source}`);

  return lines.join("\n");
}
