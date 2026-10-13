import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep, join } from "node:path";

import type { NormalizedWriteOnceConfig } from "./config.js";
import type {
  PreparedResource,
  PreparedResourceBatch,
  ResourcePreparationResult,
  SourceReferenceContext,
} from "./types.js";

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
  return id.replace(/[^A-Za-z0-9._-]/g, "-") || "preparer";
}

function referenceKey(reference: SourceReferenceContext): string {
  return `${reference.destination}\0${reference.marker.span.start}\0${reference.source}`;
}

function isSourceReferenceContext(value: unknown): value is SourceReferenceContext {
  return (
    isRecord(value) &&
    typeof value["source"] === "string" &&
    typeof value["destination"] === "string" &&
    isRecord(value["selector"]) &&
    ["whole", "named", "range"].includes(String(value["selector"]["kind"])) &&
    isRecord(value["marker"]) &&
    isRecord(value["marker"]["span"]) &&
    typeof value["marker"]["span"]["start"] === "number"
  );
}

function isPreparedResource(value: unknown): value is PreparedResource {
  return (
    isRecord(value) &&
    typeof value["root"] === "string" &&
    Array.isArray(value["references"]) &&
    value["references"].every(isSourceReferenceContext)
  );
}

function isResourcePreparationResult(value: unknown): value is ResourcePreparationResult {
  return (
    isRecord(value) &&
    Array.isArray(value["resources"]) &&
    value["resources"].every(isPreparedResource)
  );
}

function validatePreparationResult(
  value: unknown,
  references: readonly SourceReferenceContext[],
  workingDirectory: string,
): ResourcePreparationResult {
  if (!isResourcePreparationResult(value)) {
    throw new TypeError("prepare() must return an object with valid prepared resources.");
  }

  const assignedKeys = new Set(references.map(referenceKey));
  for (const resource of value.resources) {
    const root = resolve(workingDirectory, resource.root);
    if (!isWithin(workingDirectory, root)) {
      throw new TypeError(
        "A prepared resource root must remain inside its assigned working directory.",
      );
    }

    for (const reference of resource.references) {
      if (!assignedKeys.has(referenceKey(reference))) {
        throw new TypeError(
          "A prepared resource references a source not assigned to this preparer.",
        );
      }
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

/** Batch all references first, then invoke each selected preparer once in registration order. */
export async function prepareSourceReferences(
  references: readonly SourceReferenceContext[],
  config: NormalizedWriteOnceConfig,
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

    // Preparation remains sequential so each provider failure has deterministic cleanup.
    // oxlint-disable no-await-in-loop
    for (const { preparer, references: batchReferences } of assignments.batches) {
      let workingDirectory: string;
      try {
        workingDirectory = await mkdtemp(join(baseDirectory, `${safeDirectoryName(preparer.id)}-`));
        workingDirectories.push(workingDirectory);
        const result = await preparer.prepare(batchReferences, {
          cwd: config.root,
          workingDirectory,
        });
        preparations.push({
          preparerId: preparer.id,
          workingDirectory,
          references: batchReferences,
          result: validatePreparationResult(result, batchReferences, workingDirectory),
        });
      } catch (cause) {
        throw new ResourcePreparationFailure(
          preparer.id,
          batchReferences,
          `Preparer "${preparer.id}" failed for source(s) ${batchReferences.map((reference) => reference.source).join(", ")}: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        );
      }
    }
    // oxlint-enable no-await-in-loop

    return { preparations, workingDirectories };
  } catch (cause) {
    await cleanupPreparedResources({ preparations, workingDirectories });
    throw cause;
  }
}

/** Remove per-run temporary resource directories after planning and writes finish. */
export async function cleanupPreparedResources(resources: PreparedSourceResources): Promise<void> {
  await Promise.all(
    resources.workingDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
}
