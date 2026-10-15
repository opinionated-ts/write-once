import ignore from "ignore";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type { NormalizedWriteOnceConfig } from "./config.js";
import type { Diagnostic } from "./types.js";

import { mapConcurrent } from "./async-pool.js";

export interface FileDiscoveryResult {
  files: string[];
  diagnostics: Diagnostic[];
}

interface GitIgnoreMatcher {
  base: string;
  matcher: ReturnType<typeof ignore>;
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

async function loadGitIgnoreMatcher(directory: string): Promise<GitIgnoreMatcher | undefined> {
  try {
    const content = await readFile(resolve(directory, ".gitignore"), "utf8");
    return { base: directory, matcher: ignore().add(content) };
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return undefined;
    throw cause;
  }
}

function isGitIgnored(
  path: string,
  isDirectory: boolean,
  matchers: readonly GitIgnoreMatcher[],
): boolean {
  let ignored = false;
  for (const { base, matcher } of matchers) {
    const relativePath = toRelativePath(base, path);
    if (relativePath === ".." || relativePath.startsWith("../")) continue;
    const result = matcher.test(isDirectory ? relativePath + "/" : relativePath);
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }
  return ignored;
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
  const concurrency = Number.isFinite(config.maxConcurrency)
    ? Math.max(1, Math.floor(config.maxConcurrency))
    : 8;

  interface DirectoryWork {
    directory: string;
    inheritedGitIgnore: readonly GitIgnoreMatcher[];
  }

  interface DirectoryResult {
    children: DirectoryWork[];
    files: Array<{ absolute: string; relative: string }>;
    diagnostics: Diagnostic[];
  }

  async function visitDirectory({
    directory,
    inheritedGitIgnore,
  }: DirectoryWork): Promise<DirectoryResult> {
    const result: DirectoryResult = { children: [], files: [], diagnostics: [] };
    let gitIgnoreMatchers = inheritedGitIgnore;
    if (config.respectGitignore) {
      try {
        const localMatcher = await loadGitIgnoreMatcher(directory);
        if (localMatcher !== undefined) gitIgnoreMatchers = [...inheritedGitIgnore, localMatcher];
      } catch (cause) {
        result.diagnostics.push({
          severity: "error",
          message:
            "Cannot read .gitignore in " +
            JSON.stringify(directory) +
            ": " +
            (cause instanceof Error ? cause.message : String(cause)),
          stage: "discovery",
          file: resolve(directory, ".gitignore"),
          cause,
        });
        return result;
      }
    }

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (cause) {
      result.diagnostics.push({
        severity: "error",
        message: `Cannot read directory "${directory}": ${cause instanceof Error ? cause.message : String(cause)}`,
        stage: "discovery",
        file: directory,
        cause,
      });
      return result;
    }

    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

    for (const entry of entries) {
      const absolute = resolve(directory, entry.name);
      const relativePath = toRelativePath(root, absolute);

      if (entry.isDirectory()) {
        if (
          !matchesExclude(relativePath + "/__write_once_directory__", excludeMatchers) &&
          !(config.respectGitignore && isGitIgnored(absolute, true, gitIgnoreMatchers))
        ) {
          result.children.push({ directory: absolute, inheritedGitIgnore: gitIgnoreMatchers });
        }
        continue;
      }

      if (!entry.isFile()) continue;
      if (
        matchesInclude(relativePath, includeMatchers) &&
        !matchesExclude(relativePath, excludeMatchers) &&
        !(config.respectGitignore && isGitIgnored(absolute, false, gitIgnoreMatchers))
      ) {
        result.files.push({ absolute, relative: relativePath });
      }
    }

    return result;
  }

  let frontier: DirectoryWork[] = [{ directory: root, inheritedGitIgnore: [] }];
  // oxlint-disable-next-line no-await-in-loop
  while (frontier.length > 0) {
    // oxlint-disable-next-line no-await-in-loop
    const results = await mapConcurrent(frontier, concurrency, visitDirectory);
    frontier = [];
    for (const result of results) {
      files.push(...result.files);
      diagnostics.push(...result.diagnostics);
      frontier.push(...result.children);
    }
  }

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
