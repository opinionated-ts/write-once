import { basename, dirname, isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { platform } from "node:process";

import type { ResourceContext, ResourceResolver, ResolvedResource } from "../types.js";

import { SourceResolutionError } from "../errors/source-resolution-error.js";

function normalizeSourcePath(source: string, cwd: string): ResolvedResource {
  if (/^[A-Za-z]:[\\/]/.test(source) && platform !== "win32") {
    throw SourceResolutionError({
      message: "Windows absolute source paths can only be resolved on Windows.",
      context: { public: { source, cwd } },
    });
  }

  const platformPath = source.replace(/[\\/]/g, sep);
  const absoluteSource = isAbsolute(platformPath);
  const location = normalize(absoluteSource ? platformPath : resolve(cwd, platformPath));
  const root = absoluteSource ? dirname(location) : resolve(cwd);
  const path = absoluteSource ? basename(location) : relative(root, location);

  return { root, path, metadata: { source, cwd } };
}

function isLocalPath(source: string): boolean {
  return (
    source.length > 0 &&
    !source.startsWith("@repo:") &&
    !/^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(source)
  );
}

// Resolves local text files relative to the configured project root.
export const localSourceResolver: ResourceResolver = {
  id: "local-file",
  canResolve(source: string, _context: ResourceContext): boolean {
    return isLocalPath(source);
  },
  resolve(source: string, context: ResourceContext): ResolvedResource {
    if (!isLocalPath(source)) {
      throw SourceResolutionError({
        message: "Only local file sources are supported by the built-in resolver.",
        context: { public: { source } },
      });
    }

    return normalizeSourcePath(source, context.cwd);
  },
};
