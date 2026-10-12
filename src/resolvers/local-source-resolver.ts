import { readFile } from "node:fs/promises";
import { isAbsolute, normalize, resolve, sep } from "node:path";
import { platform } from "node:process";

import type { ResourceContext, ResourceResolver, ResolvedResource } from "../types.js";

import { SourceResolutionError } from "../errors/source-resolution-error.js";

function normalizeSourcePath(source: string, cwd: string): string {
  if (/^[A-Za-z]:[\\/]/.test(source) && platform !== "win32") {
    throw SourceResolutionError({
      message: "Windows absolute source paths can only be resolved on Windows.",
      context: { public: { source, cwd } },
    });
  }

  const platformPath = source.replace(/[\\/]/g, sep);
  return normalize(isAbsolute(platformPath) ? platformPath : resolve(cwd, platformPath));
}

function isLocalPath(source: string): boolean {
  return (
    source.length > 0 &&
    !source.startsWith("@repo:") &&
    !/^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(source)
  );
}

/** Resolves local text files relative to the configured project root. */
export const localSourceResolver: ResourceResolver = {
  id: "local-file",
  canResolve(source: string, _context: ResourceContext): boolean {
    return isLocalPath(source);
  },
  async resolve(source: string, context: ResourceContext): Promise<ResolvedResource> {
    if (!isLocalPath(source)) {
      throw SourceResolutionError({
        message: "Only local file sources are supported by the built-in resolver.",
        context: { public: { source } },
      });
    }

    const location = normalizeSourcePath(source, context.cwd);
    let text: string;

    try {
      text = await readFile(location, "utf8");
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw SourceResolutionError({
        message: `Could not read source "${source}": ${reason}`,
        context: { public: { source, location, cwd: context.cwd }, cause },
      });
    }

    return {
      id: `file:${location}`,
      location,
      text,
      metadata: { source, cwd: context.cwd },
    };
  },
};
