import { error, isFailure, ok } from "@opinionated-ts/result";
import { loadConfig, SUPPORTED_EXTENSIONS } from "c12";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

import type { NormalizedWriteOnceConfig } from "./config.js";

import { validateConfig } from "./config.js";
import { ConfigLoadError } from "./errors/config-load-error.js";

export interface LoadWriteOnceConfigOptions {
  cwd: string;
  configPath?: string;
}

export interface LoadedWriteOnceConfig {
  config: NormalizedWriteOnceConfig;
  configFile?: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return false;
    throw cause;
  }
}

async function discoverConfigFiles(cwd: string): Promise<string[]> {
  const candidates = SUPPORTED_EXTENSIONS.flatMap((extension) => [
    resolve(cwd, `write-once.config${extension}`),
    resolve(cwd, `.config/write-once.config${extension}`),
  ]);
  const results = await Promise.all(
    candidates.map(async (candidate) => ((await exists(candidate)) ? candidate : undefined)),
  );
  return results.filter((candidate): candidate is string => candidate !== undefined);
}

function loadError(message: string, context: Record<string, unknown> = {}) {
  return error(ConfigLoadError({ message, context: { public: context } }));
}

/**
 * Load and validate optional write-once configuration.
 *
 * TypeScript and JavaScript config files execute user code when loaded. Only
 * one discovered config is accepted; use configPath to select one explicitly.
 */
export async function loadWriteOnceConfig(options: LoadWriteOnceConfigOptions) {
  const cwd = resolve(options.cwd);
  let configFile: string | undefined;

  if (options.configPath !== undefined) {
    configFile = resolve(cwd, options.configPath);
  } else {
    try {
      const candidates = await discoverConfigFiles(cwd);
      if (candidates.length > 1) {
        return loadError(
          "Multiple write-once configuration files were found. Select one with --config <path>.",
          { cwd, candidates },
        );
      }
      configFile = candidates[0];
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      return loadError(`Could not discover write-once config files: ${reason}`, { cwd, cause });
    }
  }

  try {
    const loaded = await loadConfig({
      name: "write-once",
      cwd,
      configFile: configFile ?? resolve(cwd, "write-once.config.json"),
      configFileRequired: options.configPath !== undefined,
      rcFile: false,
      packageJson: false,
      globalRc: false,
      dotenv: false,
      envName: false,
      extend: {},
      defaults: {},
    });

    const validated = validateConfig(loaded.config ?? {}, cwd);
    if (isFailure(validated)) return error(validated.error);

    return ok({
      config: validated.value,
      ...(configFile === undefined ? {} : { configFile }),
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return loadError(`Could not load write-once config: ${reason}`, {
      cwd,
      ...(configFile === undefined ? {} : { configFile }),
      cause,
    });
  }
}
