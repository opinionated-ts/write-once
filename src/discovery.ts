import ignore from "ignore";
import { readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type { NormalizedWriteOnceConfig } from "./config.js";
import type { Diagnostic } from "./types.js";

export interface FileDiscoveryResult {
  files: string[];
  diagnostics: Diagnostic[];
}

function toRelativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function compilePatterns(patterns: readonly string[], mode: "include" | "exclude") {
  return patterns.map((pattern) => {
    if (pattern.includes("\0") || pattern.startsWith("!")) {
      throw new TypeError(
        `Invalid ${mode} pattern "${pattern}". Patterns must be positive Git-ignore-style patterns.`,
      );
    }

    if (mode === "include") {
      return ignore().add(["**", "!**/", `!${pattern}`]);
    }

    return ignore().add(pattern);
  });
}

function matchesInclude(path: string, matchers: ReturnType<typeof compilePatterns>): boolean {
  return matchers.some((matcher) => !matcher.ignores(path));
}

function matchesExclude(path: string, matchers: ReturnType<typeof compilePatterns>): boolean {
  return matchers.some((matcher) => matcher.ignores(path));
}

/** Discover destination files in deterministic order using Git-ignore-style patterns. */
export async function discoverDestinationFiles(
  config: NormalizedWriteOnceConfig,
): Promise<FileDiscoveryResult> {
  const diagnostics: Diagnostic[] = [];
  let includeMatchers: ReturnType<typeof compilePatterns>;
  let excludeMatchers: ReturnType<typeof compilePatterns>;

  try {
    includeMatchers = compilePatterns(config.include, "include");
    excludeMatchers = compilePatterns(config.exclude, "exclude");
  } catch (cause) {
    return {
      files: [],
      diagnostics: [
        {
          severity: "error",
          message: cause instanceof Error ? cause.message : String(cause),
          stage: "discovery",
          cause,
        },
      ],
    };
  }

  const root = resolve(config.root);
  const files: Array<{ absolute: string; relative: string }> = [];

  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (cause) {
      diagnostics.push({
        severity: "error",
        message: `Cannot read directory "${directory}": ${cause instanceof Error ? cause.message : String(cause)}`,
        stage: "discovery",
        file: directory,
        cause,
      });
      return;
    }

    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

    const childDirectories: string[] = [];
    for (const entry of entries) {
      const absolute = resolve(directory, entry.name);
      const relativePath = toRelativePath(root, absolute);

      if (entry.isDirectory()) {
        if (!matchesExclude(`${relativePath}/__write_once_directory__`, excludeMatchers)) {
          childDirectories.push(absolute);
        }
        continue;
      }

      if (!entry.isFile()) continue;
      if (
        matchesInclude(relativePath, includeMatchers) &&
        !matchesExclude(relativePath, excludeMatchers)
      ) {
        files.push({ absolute, relative: relativePath });
      }
    }

    await Promise.all(childDirectories.map(visit));
  }

  await visit(root);
  files.sort((left, right) =>
    left.relative < right.relative ? -1 : left.relative > right.relative ? 1 : 0,
  );

  diagnostics.sort((left, right) => {
    const leftKey = `${left.file ?? ""}:${left.message}`;
    const rightKey = `${right.file ?? ""}:${right.message}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });

  if (files.length === 0 && diagnostics.length === 0) {
    diagnostics.push({
      severity: "warning",
      message: "No destination files matched the configured include/exclude patterns.",
      stage: "discovery",
    });
  }

  return { files: files.map(({ absolute }) => absolute), diagnostics };
}
