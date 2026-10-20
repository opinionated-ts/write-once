import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep, join } from "node:path";

import type { NormalizedWriteOnceConfig } from "./config.js";
import type {
  GenerationProgressEvent,
  GenerationProgressReporter,
  PreparedResource,
  PreparedResourceBatch,
  ResourcePreparationResult,
  SourceReferenceContext,
} from "./types.js";

import { mapConcurrent } from "./async-pool.js";
import { assignPreparerReferences, PreparerTriggerError } from "./preparer-selection.js";

export interface PreparedSourceResources {
  preparations: PreparedResourceBatch[];
  workingDirectories: string[];
}

export class ResourcePreparationFailure extends Error {
  constructor(
    readonly preparerId: string,
    readonly references: readonly SourceReferenceContext[],
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "ResourcePreparationFailure";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function safeDirectoryName(id: string): string {
  const name = id.replace(/[^A-Za-z0-9._-]/g, "-") || "preparer";
  const suffix = createHash("sha256").update(id).digest("hex").slice(0, 12);
  return `${name}-${suffix}`;
}

function projectWorkspaceDirectory(root: string): string {
  const projectId = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return join(tmpdir(), "write-once", "workspaces", projectId);
}

function isPreparedResource(value: unknown): value is PreparedResource {
  return (
    isRecord(value) &&
    typeof value["root"] === "string" &&
    value["root"].length > 0 &&
    (value["metadata"] === undefined || isRecord(value["metadata"]))
  );
}

function isResourcePreparationResult(value: unknown): value is ResourcePreparationResult {
  return (
    isRecord(value) &&
    Array.isArray(value["resources"]) &&
    value["resources"].every(isPreparedResource) &&
    (value["metadata"] === undefined || isRecord(value["metadata"]))
  );
}

function validatePreparationResult(
  value: unknown,
  workingDirectory: string,
  workspaceDirectory: string,
): ResourcePreparationResult {
  if (!isResourcePreparationResult(value)) {
    throw new TypeError(
      "prepare() must return an object with valid prepared resources and object metadata.",
    );
  }

  for (const resource of value.resources) {
    const root = resolve(workingDirectory, resource.root);
    if (!isWithin(workingDirectory, root) && !isWithin(workspaceDirectory, root)) {
      throw new TypeError(
        "A prepared resource root must remain inside its temporary directory or persistent workspace.",
      );
    }
  }

  return {
    ...value,
    resources: value.resources.map((resource) => ({
      ...resource,
      root: resolve(workingDirectory, resource.root),
    })),
  };
}

// Batch all references first, then invoke each selected preparer once in registration order.
function emitProgress(
  reporter: GenerationProgressReporter | undefined,
  event: GenerationProgressEvent,
): void {
  try {
    reporter?.(event);
  } catch {
    // Reporting must never interrupt resource preparation.
  }
}

export async function prepareSourceReferences(
  references: readonly SourceReferenceContext[],
  config: NormalizedWriteOnceConfig,
  onProgress?: GenerationProgressReporter,
): Promise<PreparedSourceResources> {
  const workingDirectories: string[] = [];
  const preparations: PreparedResourceBatch[] = [];

  let assignments;
  try {
    assignments = assignPreparerReferences(config.preparers, references, (reference) => ({
      cwd: config.root,
      destination: reference.destination,
    }));
  } catch (cause) {
    if (cause instanceof PreparerTriggerError) {
      throw new ResourcePreparationFailure(
        cause.preparerId,
        [cause.reference],
        `Preparer trigger "${cause.preparerId}" failed for source "${cause.reference.source}".`,
        cause.cause,
      );
    }
    throw new ResourcePreparationFailure(
      "<selection>",
      references,
      "Could not select resource preparers.",
      cause,
    );
  }

  try {
    if (assignments.batches.length === 0) return { preparations, workingDirectories };

    const baseDirectory = join(tmpdir(), "write-once");
    await mkdir(baseDirectory, { recursive: true });

    const workspaceBaseDirectory = projectWorkspaceDirectory(config.root);
    const batches = await mapConcurrent(
      assignments.batches,
      config.maxConcurrency,
      async ({ preparer, references: batchReferences }) => {
        let workingDirectory: string;
        const workspaceDirectory = join(workspaceBaseDirectory, safeDirectoryName(preparer.id));
        try {
          await mkdir(workspaceDirectory, { recursive: true });
          workingDirectory = await mkdtemp(
            join(baseDirectory, `${safeDirectoryName(preparer.id)}-`),
          );
          workingDirectories.push(workingDirectory);
          const pluginName = config.pluginNames.get(preparer);
          const displayName = pluginName ?? preparer.id;
          emitProgress(onProgress, {
            pluginId: preparer.id,
            ...(pluginName === undefined ? {} : { pluginName }),
            phase: "start",
            message: `Plugin "${displayName}" is preparing resources. This may take some time...`,
          });
          const result = await preparer.prepare(batchReferences, {
            cwd: config.root,
            workingDirectory,
            workspaceDirectory,
            reportProgress(message) {
              if (message.trim().length === 0) return;
              emitProgress(onProgress, {
                pluginId: preparer.id,
                ...(pluginName === undefined ? {} : { pluginName }),
                phase: "progress",
                message: `Plugin "${displayName}": ${message}`,
              });
            },
          });
          const validatedResult = validatePreparationResult(
            result,
            workingDirectory,
            workspaceDirectory,
          );
          emitProgress(onProgress, {
            pluginId: preparer.id,
            ...(pluginName === undefined ? {} : { pluginName }),
            phase: "success",
            message: `Plugin "${displayName}" finished preparing resources.`,
          });
          return {
            preparerId: preparer.id,
            workingDirectory,
            workspaceDirectory,
            references: batchReferences,
            result: validatedResult,
          };
        } catch (cause) {
          const pluginName = config.pluginNames.get(preparer);
          emitProgress(onProgress, {
            pluginId: preparer.id,
            ...(pluginName === undefined ? {} : { pluginName }),
            phase: "failure",
            message: `Plugin "${pluginName ?? preparer.id}" failed while preparing resources.`,
          });
          throw new ResourcePreparationFailure(
            preparer.id,
            batchReferences,
            `Preparer "${preparer.id}" failed for source(s) ${batchReferences.map((reference) => reference.source).join(", ")}: ${cause instanceof Error ? cause.message : String(cause)}`,
            cause,
          );
        }
      },
    );
    preparations.push(...batches);

    return { preparations, workingDirectories };
  } catch (cause) {
    await cleanupPreparedResources({ preparations, workingDirectories });
    throw cause;
  }
}

// Remove per-run temporary resource directories after planning and writes finish.
export async function cleanupPreparedResources(resources: PreparedSourceResources): Promise<void> {
  await Promise.all(
    resources.workingDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
}
