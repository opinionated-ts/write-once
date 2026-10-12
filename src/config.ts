import { error, ok } from "@opinionated-ts/result";
import { resolve } from "node:path";

import type { ContentExtractor, GenerationHook, ResourceResolver } from "./types.js";

import { ConfigValidationError } from "./errors/config-validation-error.js";

export interface WriteOnceConfig {
  root?: string;
  include?: readonly string[];
  exclude?: readonly string[];
  resolvers?: readonly ResourceResolver[];
  extractors?: readonly ContentExtractor[];
  hooks?: readonly GenerationHook[];
}

export interface NormalizedWriteOnceConfig {
  root: string;
  include: readonly string[];
  exclude: readonly string[];
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

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
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
  if (root !== undefined && (typeof root !== "string" || root.trim().length === 0)) {
    return invalid('"root" must be a non-empty path string.', "root");
  }

  const include = value["include"] ?? ["**/*"];
  if (!isStringArray(include))
    return invalid('"include" must be an array of non-empty pattern strings.', "include");

  const exclude = value["exclude"] ?? [];
  if (!isStringArray(exclude))
    return invalid('"exclude" must be an array of non-empty pattern strings.', "exclude");

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
    include: [...include],
    exclude: [...exclude],
    resolvers: [...resolvers],
    extractors: [...extractors],
    hooks: [...hooks],
  });
}
