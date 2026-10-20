import { error, ok } from "@opinionated-ts/result";
import { createDefineConfig } from "c12";
import { resolve } from "node:path";

import type {
  ContentExtractor,
  GenerationHook,
  PluginConfigEntry,
  PluginContribution,
  PluginFactory,
  ResourcePreparer,
  ResourceResolver,
} from "./types.js";

import { ConfigValidationError } from "./errors/config-validation-error.js";

export const DEFAULT_EXCLUDE_PATTERNS = ["**/.git/**", "**/node_modules/**"] as const;

/** Options for configuring a Write Once generation run. */
export interface UserConfig {
  root?: string;
  include?: readonly string[];
  exclude?: readonly string[];
  respectGitignore?: boolean;
  /** Maximum concurrent pipeline operations. Defaults to unlimited. */
  maxConcurrency?: number;
  /** Approximate retained source-content budget in MiB. Defaults to 256 MiB. */
  memoryBudgetMiB?: number;
  preparers?: readonly ResourcePreparer[];
  resolvers?: readonly ResourceResolver[];
  extractors?: readonly ContentExtractor[];
  hooks?: readonly GenerationHook[];
  /** Plugin contributions or factories composed during configuration validation. */
  plugins?: readonly PluginConfigEntry[];
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
  maxConcurrency?: number;
  memoryBudgetMiB?: number;
}

/** Validated configuration with defaults applied and paths resolved. */
export interface NormalizedWriteOnceConfig {
  root: string;
  include: readonly string[];
  exclude: readonly string[];
  respectGitignore: boolean;
  maxConcurrency: number;
  memoryBudgetMiB: number;
  preparers: readonly ResourcePreparer[];
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
    !("priority" in value) &&
    typeof value["id"] === "string" &&
    value["id"].length > 0 &&
    typeof value["canResolve"] === "function" &&
    typeof value["resolve"] === "function"
  );
}

function isPreparer(value: unknown): value is ResourcePreparer {
  return (
    isRecord(value) &&
    !("priority" in value) &&
    typeof value["id"] === "string" &&
    value["id"].length > 0 &&
    typeof value["canPrepare"] === "function" &&
    typeof value["prepare"] === "function"
  );
}

function isExtractor(value: unknown): value is ContentExtractor {
  return (
    isRecord(value) &&
    !("priority" in value) &&
    typeof value["id"] === "string" &&
    value["id"].length > 0 &&
    typeof value["canExtract"] === "function" &&
    typeof value["extract"] === "function"
  );
}

function isHook(value: unknown): value is GenerationHook {
  return (
    isRecord(value) &&
    !("priority" in value) &&
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

function isPluginContribution(value: unknown): value is PluginContribution {
  if (!isRecord(value)) return false;
  if (value["name"] !== undefined && typeof value["name"] !== "string") return false;
  return (["preparers", "resolvers", "extractors", "hooks"] as const).every(
    (key) => value[key] === undefined || Array.isArray(value[key]),
  );
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
  const maxConcurrency = value["maxConcurrency"];
  const memoryBudgetMiB = value["memoryBudgetMiB"];

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

  if (
    maxConcurrency !== undefined &&
    (typeof maxConcurrency !== "number" ||
      !Number.isSafeInteger(maxConcurrency) ||
      maxConcurrency < 1)
  ) {
    return invalid(`"maxConcurrency" must be a positive safe integer.`, "maxConcurrency");
  }
  if (
    memoryBudgetMiB !== undefined &&
    (typeof memoryBudgetMiB !== "number" ||
      !Number.isFinite(memoryBudgetMiB) ||
      memoryBudgetMiB <= 0)
  ) {
    return invalid(`"memoryBudgetMiB" must be a positive finite number.`, "memoryBudgetMiB");
  }

  const includePatterns = include ?? ["**/*"];
  const excludePatterns = exclude ?? DEFAULT_EXCLUDE_PATTERNS;

  const pluginEntries = value["plugins"] === undefined ? [] : value["plugins"];
  if (
    !Array.isArray(pluginEntries) ||
    !pluginEntries.every((plugin) => typeof plugin === "function" || isPluginContribution(plugin))
  ) {
    return invalid(
      '"plugins" must be an array of plugin contributions or factory functions.',
      "plugins",
    );
  }

  const contributions: PluginContribution[] = [];
  for (const entry of pluginEntries as readonly PluginConfigEntry[]) {
    let contribution: unknown = entry;
    if (typeof entry === "function") {
      try {
        contribution = (entry as PluginFactory)();
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        return invalid(`A plugin factory failed: ${reason}`, "plugins");
      }
    }
    if (!isPluginContribution(contribution)) {
      return invalid("Each plugin must be an object with optional capability arrays.", "plugins");
    }
    contributions.push(contribution);
  }

  // Explicit capabilities take precedence by registration order; plugin capabilities follow in plugin order.
  const pluginValues = (key: "preparers" | "resolvers" | "extractors" | "hooks"): unknown[] =>
    contributions.reduce<unknown[]>((values, contribution) => {
      const items = contribution[key];
      if (items !== undefined) values.push(...items);
      return values;
    }, []);
  const configuredValues = (key: "preparers" | "resolvers" | "extractors" | "hooks"): unknown[] => {
    const direct = value[key];
    return direct === undefined ? [] : Array.isArray(direct) ? direct : [direct];
  };

  const preparers = [...configuredValues("preparers"), ...pluginValues("preparers")];
  if (!Array.isArray(preparers) || !preparers.every(isPreparer)) {
    return invalid(
      '"preparers" must contain preparer objects with id, canPrepare, and prepare.',
      "preparers",
    );
  }

  const resolvers = [...configuredValues("resolvers"), ...pluginValues("resolvers")];
  if (!Array.isArray(resolvers) || !resolvers.every(isResolver)) {
    return invalid(
      '"resolvers" must contain resolver objects with id, canResolve, and resolve.',
      "resolvers",
    );
  }

  const extractors = [...configuredValues("extractors"), ...pluginValues("extractors")];
  if (!Array.isArray(extractors) || !extractors.every(isExtractor)) {
    return invalid(
      '"extractors" must contain extractor objects with id, canExtract, and extract.',
      "extractors",
    );
  }

  const hooks = [...configuredValues("hooks"), ...pluginValues("hooks")];
  if (!Array.isArray(hooks) || !hooks.every(isHook)) {
    return invalid('"hooks" must contain hook objects with id, stage, and run.', "hooks");
  }

  if (
    hasDuplicateIds(preparers) ||
    hasDuplicateIds(resolvers) ||
    hasDuplicateIds(extractors) ||
    hasDuplicateIds(hooks)
  ) {
    return invalid("Identifiers must be unique within each capability category.");
  }

  return ok({
    root: resolve(cwd, typeof root === "string" ? root : "."),
    include: [...includePatterns],
    exclude: [...excludePatterns],
    respectGitignore: respectGitignore ?? true,
    maxConcurrency: typeof maxConcurrency === "number" ? maxConcurrency : Number.POSITIVE_INFINITY,
    memoryBudgetMiB: typeof memoryBudgetMiB === "number" ? memoryBudgetMiB : 256,
    preparers: [...preparers],
    resolvers: [...resolvers],
    extractors: [...extractors],
    hooks: [...hooks],
  });
}
