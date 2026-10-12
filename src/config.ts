import { error, ok } from "@opinionated-ts/result";
import { createDefineConfig } from "c12";
import { resolve } from "node:path";
import { z } from "zod";

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

/** Schema for the JSON-serializable options in write-once configuration files. */
export const writeOnceConfigSchema = z
  .object({
    root: z
      .string()
      .refine((value) => value.trim().length > 0)
      .optional(),
    include: z.array(z.string().refine((value) => value.trim().length > 0)).optional(),
    exclude: z.array(z.string().refine((value) => value.trim().length > 0)).optional(),
    respectGitignore: z.boolean().optional(),
  })
  .passthrough();

export type WriteOnceJsonConfig = z.infer<typeof writeOnceConfigSchema>;

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

  const parsed = writeOnceConfigSchema.safeParse(value);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const messages: Record<string, string> = {
      root: '"root" must be a non-empty path string.',
      include: '"include" must be an array of non-empty pattern strings.',
      exclude: '"exclude" must be an array of non-empty pattern strings.',
      respectGitignore: '"respectGitignore" must be a boolean.',
    };
    return invalid(
      typeof field === "string"
        ? (messages[field] ?? "Configuration contains an invalid value.")
        : "Configuration contains an invalid value.",
      typeof field === "string" ? field : undefined,
    );
  }

  const config = parsed.data;
  const root = config.root;
  const include = config.include ?? ["**/*"];
  const exclude = config.exclude ?? DEFAULT_EXCLUDE_PATTERNS;
  const respectGitignore = config.respectGitignore ?? true;

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
    respectGitignore,
    resolvers: [...resolvers],
    extractors: [...extractors],
    hooks: [...hooks],
  });
}
