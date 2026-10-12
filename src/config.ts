import { error, ok } from "@opinionated-ts/result";
import { createDefineConfig } from "c12";
import { resolve } from "node:path";

import type { ContentExtractor, GenerationHook, ResourceResolver } from "./types.js";

import { ConfigValidationError } from "./errors/config-validation-error.js";

export const DEFAULT_EXCLUDE_PATTERNS = ["**/.git/**", "**/node_modules/**"] as const;

export interface UserConfig {
  root?: string;
  include?: readonly string[];
  exclude?: readonly string[];
  respectGitignore?: boolean;
  resolvers?: readonly ResourceResolver[];
  extractors?: readonly ContentExtractor[];
  hooks?: readonly GenerationHook[];
}

/** Backwards-compatible name for {@link UserConfig}. */
export type WriteOnceConfig = UserConfig;

/** TypeScript configuration helper with c12's reserved environment keys. */
export const defineConfig = createDefineConfig<UserConfig & Record<string, unknown>>();

/** JSON-serializable configuration options supported by JSON and YAML files. */
export interface WriteOnceJsonConfig {
  root?: string;
  include?: readonly string[];
  exclude?: readonly string[];
  respectGitignore?: boolean;
}

export interface NormalizedWriteOnceConfig {
  root: string;
  include: readonly string[];
  exclude: readonly string[];
  respectGitignore: boolean;
  resolvers: readonly ResourceResolver[];
  extractors: readonly ContentExtractor[];
  hooks: readonly GenerationHook[];
}

function invalid(message: string, field?: string) {
  return error(
    ConfigValidationError({
      message,
      context: { public: field === undefined ? {} : { field } },
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isResolver(value: unknown): value is ResourceResolver {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    value["id"].length > 0 &&
    typeof value["canResolve"] === "function" &&
    typeof value["resolve"] === "function"
  );
}

function isExtractor(value: unknown): value is ContentExtractor {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    value["id"].length > 0 &&
    typeof value["canExtract"] === "function" &&
    typeof value["extract"] === "function"
  );
}

function isHook(value: unknown): value is GenerationHook {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    value["id"].length > 0 &&
    typeof value["stage"] === "string" &&
    value["stage"].length > 0 &&
    typeof value["run"] === "function"
  );
}

function hasDuplicateIds(items: Array<{ id: string }>): boolean {
  return new Set(items.map((item) => item.id)).size !== items.length;
}

/** Validate untrusted configuration input and resolve its project root. */
export function validateConfig(
  value: unknown,
  cwd: string,
): ReturnType<typeof ok<NormalizedWriteOnceConfig>> | ReturnType<typeof invalid> {
  if (!isRecord(value)) return invalid("Configuration must be an object.");

  const root = value["root"];
  const include = value["include"];
  const exclude = value["exclude"];
  const respectGitignore = value["respectGitignore"];

  if (root !== undefined && (typeof root !== "string" || root.trim().length === 0)) {
    return invalid('"root" must be a non-empty path string.', "root");
  }
  if (
    include !== undefined &&
    (!Array.isArray(include) ||
      !include.every((pattern) => typeof pattern === "string" && pattern.trim().length > 0))
  ) {
    return invalid('"include" must be an array of non-empty pattern strings.', "include");
  }
  if (
    exclude !== undefined &&
    (!Array.isArray(exclude) ||
      !exclude.every((pattern) => typeof pattern === "string" && pattern.trim().length > 0))
  ) {
    return invalid('"exclude" must be an array of non-empty pattern strings.', "exclude");
  }
  if (respectGitignore !== undefined && typeof respectGitignore !== "boolean") {
    return invalid('"respectGitignore" must be a boolean.', "respectGitignore");
  }

  const includePatterns = include ?? ["**/*"];
  const excludePatterns = exclude ?? DEFAULT_EXCLUDE_PATTERNS;

  const resolvers = value["resolvers"] ?? [];
  if (!Array.isArray(resolvers) || !resolvers.every(isResolver)) {
    return invalid(
      '"resolvers" must contain resolver objects with id, canResolve, and resolve.',
      "resolvers",
    );
  }

  const extractors = value["extractors"] ?? [];
  if (!Array.isArray(extractors) || !extractors.every(isExtractor)) {
    return invalid(
      '"extractors" must contain extractor objects with id, canExtract, and extract.',
      "extractors",
    );
  }

  const hooks = value["hooks"] ?? [];
  if (!Array.isArray(hooks) || !hooks.every(isHook)) {
    return invalid('"hooks" must contain hook objects with id, stage, and run.', "hooks");
  }

  if (hasDuplicateIds(resolvers) || hasDuplicateIds(extractors) || hasDuplicateIds(hooks)) {
    return invalid("Identifiers must be unique within each capability category.");
  }

  return ok({
    root: resolve(cwd, typeof root === "string" ? root : "."),
    include: [...includePatterns],
    exclude: [...excludePatterns],
    respectGitignore: respectGitignore ?? true,
    resolvers: [...resolvers],
    extractors: [...extractors],
    hooks: [...hooks],
  });
}
