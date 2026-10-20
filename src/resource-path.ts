import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

import type { ResolvedResource, ResourceContext } from "./types.js";

import { SourceResolutionError } from "./errors/source-resolution-error.js";

export interface NormalizedResourcePath extends ResolvedResource {
  id: string;
  location: string;
  absolutePath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function fail(
  source: string,
  resolverId: string,
  context: ResourceContext,
  message: string,
  cause?: unknown,
): never {
  throw SourceResolutionError({
    message,
    context: {
      public: {
        source,
        resolverId,
        cwd: context.cwd,
        destination: context.destination,
      },
      cause,
    },
  });
}

// Normalize and validate a resolver location, including symlink containment.
export async function normalizeResolvedResource(
  value: unknown,
  source: string,
  resolverId: string,
  context: ResourceContext,
): Promise<NormalizedResourcePath> {
  if (
    !isRecord(value) ||
    typeof value["root"] !== "string" ||
    value["root"].length === 0 ||
    typeof value["path"] !== "string" ||
    value["path"].length === 0
  ) {
    return fail(
      source,
      resolverId,
      context,
      `Resolver "${resolverId}" returned an invalid resource path.`,
    );
  }

  if (value["metadata"] !== undefined && !isRecord(value["metadata"])) {
    return fail(source, resolverId, context, `Resolver "${resolverId}" returned invalid metadata.`);
  }
  const sourcePath = value["path"].replace(/[\\/]/g, sep);
  if (isAbsolute(sourcePath) || /^[A-Za-z]:[\\/]/.test(value["path"])) {
    return fail(
      source,
      resolverId,
      context,
      `Resolver "${resolverId}" returned an absolute path where a relative path is required.`,
    );
  }

  let root: string;
  let candidate: string;
  try {
    root = resolve(context.cwd, value["root"]);
    const normalizedPath = normalize(sourcePath);
    candidate = resolve(root, normalizedPath);
    if (normalizedPath === "." || !isWithin(root, candidate)) {
      return fail(
        source,
        resolverId,
        context,
        `Resolved path escapes its declared root for source "${source}".`,
      );
    }
  } catch (cause) {
    return fail(
      source,
      resolverId,
      context,
      `Resolver "${resolverId}" returned an invalid path.`,
      cause,
    );
  }

  const assignedPreparation = context.preparation;
  if (assignedPreparation !== undefined) {
    const preparedRoots = new Set(
      assignedPreparation.result.resources.map((resource) => resolve(context.cwd, resource.root)),
    );
    if (!preparedRoots.has(root)) {
      return fail(
        source,
        resolverId,
        context,
        `Resolver "${resolverId}" returned root "${value["root"]}" that was not declared by the assigned preparation for source "${source}". Return one of that preparation's resource roots.`,
      );
    }
  }

  try {
    const realRoot = await realpath(root);
    const rootStats = await stat(realRoot);
    if (!rootStats.isDirectory()) {
      return fail(
        source,
        resolverId,
        context,
        `Resolved root is not a directory for source "${source}".`,
      );
    }

    // Validate physical containment for both ephemeral and persistent preparer roots.
    if (assignedPreparation !== undefined) {
      const allowedDirectories = [
        assignedPreparation.workingDirectory,
        assignedPreparation.workspaceDirectory,
      ];
      const allowedDirectory = allowedDirectories.find((directory) => isWithin(directory, root));
      if (allowedDirectory !== undefined) {
        const realAllowedDirectory = await realpath(allowedDirectory);
        if (!isWithin(realAllowedDirectory, realRoot)) {
          return fail(
            source,
            resolverId,
            context,
            `Resolved root escapes preparer "${assignedPreparation.preparerId}" assigned directory.`,
          );
        }
      }
    }

    const realCandidate = await realpath(candidate);
    if (!isWithin(realRoot, realCandidate)) {
      return fail(
        source,
        resolverId,
        context,
        `Resolved path follows a symlink outside its declared root for source "${source}".`,
      );
    }

    const fileStats = await stat(realCandidate);
    if (!fileStats.isFile()) {
      return fail(
        source,
        resolverId,
        context,
        `Resolved path is not a file for source "${source}".`,
      );
    }

    const path = normalize(relative(root, candidate));
    return {
      root: realRoot,
      path,
      id: `file:${realRoot}${sep}${path}`,
      location: join(realRoot, path),
      absolutePath: join(realRoot, path),
      ...(isRecord(value["metadata"]) ? { metadata: value["metadata"] } : {}),
    };
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "SOURCE_RESOLUTION_ERROR") {
      throw cause;
    }
    return fail(
      source,
      resolverId,
      context,
      `Could not validate resolved source "${source}": ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    );
  }
}
