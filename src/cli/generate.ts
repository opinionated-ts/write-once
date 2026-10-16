import { isFailure } from "@opinionated-ts/result";
import { readFile } from "node:fs/promises";

import type { Diagnostic, SourceReferenceContext } from "../types.js";

import { mapConcurrent } from "../async-pool.js";
import { loadWriteOnceConfig } from "../config-loader.js";
import { discoverDestinationFiles } from "../discovery.js";
import {
  planDestinationFile,
  resolveSourceReferences,
  scanDestinationFile,
  type DestinationPlan,
  type DestinationScan,
  type ResolvedReference,
} from "../generation-plan.js";
import {
  cleanupPreparedResources,
  prepareSourceReferences,
  ResourcePreparationFailure,
} from "../resource-preparation.js";
import { createResourceReader } from "../resource-reader.js";
import { writeDestinationPlans } from "../safe-write.js";
import { createSourceIndexCache } from "../source-index-cache.js";

export interface GenerateOptions {
  cwd?: string;
  configPath?: string;
}

export interface GenerateResult {
  exitCode: number;
  diagnostics: Diagnostic[];
  discoveredCount: number;
  plannedCount: number;
  written: string[];
  unchanged: string[];
}

class SourceLoadFailure extends Error {
  constructor(
    readonly reference: SourceReferenceContext,
    cause: unknown,
  ) {
    super("Could not load source " + reference.source + ".", { cause });
    this.name = "SourceLoadFailure";
  }
}

// Run generation without coupling command output to the pipeline.
export async function runGenerate(options: GenerateOptions = {}): Promise<GenerateResult> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadWriteOnceConfig({
    cwd,
    ...(options.configPath === undefined ? {} : { configPath: options.configPath }),
  });
  if (isFailure(loaded)) {
    return {
      exitCode: 1,
      diagnostics: [
        { severity: "error", stage: "config", message: loaded.error.message, cause: loaded.error },
      ],
      discoveredCount: 0,
      plannedCount: 0,
      written: [],
      unchanged: [],
    };
  }

  const discovery = await discoverDestinationFiles(loaded.value.config);
  const diagnostics = [...discovery.diagnostics];
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return {
      exitCode: 1,
      diagnostics,
      discoveredCount: discovery.files.length,
      plannedCount: 0,
      written: [],
      unchanged: [],
    };
  }

  const inputResults = await mapConcurrent(
    discovery.files,
    loaded.value.config.maxConcurrency,
    async (destination) => {
      try {
        const text = await readFile(destination, "utf8");
        const scan = scanDestinationFile(destination, text);
        return scan.ok
          ? { input: { destination, text, scan: scan.value } }
          : { diagnostic: scan.error };
      } catch (cause) {
        return {
          diagnostic: {
            severity: "error" as const,
            stage: "generate" as const,
            message: `Could not read destination: ${cause instanceof Error ? cause.message : String(cause)}`,
            file: destination,
            cause,
          },
        };
      }
    },
  );
  const inputs: Array<{ destination: string; text: string; scan: DestinationScan }> = [];
  for (const result of inputResults) {
    if ("input" in result && result.input !== undefined) inputs.push(result.input);
    else diagnostics.push(result.diagnostic);
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return {
      exitCode: 1,
      diagnostics,
      discoveredCount: discovery.files.length,
      plannedCount: 0,
      written: [],
      unchanged: [],
    };
  }

  const references = inputs.flatMap((input) => input.scan.references);
  let prepared;
  try {
    prepared = await prepareSourceReferences(references, loaded.value.config);
  } catch (cause) {
    const failure =
      cause instanceof ResourcePreparationFailure
        ? cause
        : new ResourcePreparationFailure(
            "<unknown>",
            references,
            "Resource preparation failed.",
            cause,
          );
    const reference = failure.references[0];
    diagnostics.push({
      severity: "error",
      stage: "prepare",
      message: failure.message,
      ...(reference === undefined
        ? {}
        : {
            file: reference.destination,
            markerLocation: reference.marker.opening.location,
            source: reference.source,
          }),
      cause: failure,
    });
    return {
      exitCode: 1,
      diagnostics,
      discoveredCount: discovery.files.length,
      plannedCount: 0,
      written: [],
      unchanged: [],
    };
  }

  const resolvedResult = await resolveSourceReferences(
    references,
    loaded.value.config,
    prepared.preparations,
  );
  diagnostics.push(...resolvedResult.diagnostics);
  if (resolvedResult.diagnostics.length > 0) {
    await cleanupPreparedResources(prepared);
    return {
      exitCode: 1,
      diagnostics,
      discoveredCount: discovery.files.length,
      plannedCount: 0,
      written: [],
      unchanged: [],
    };
  }
  const consumers = new Map<string, number>();
  for (const value of resolvedResult.resolved.values()) {
    consumers.set(value.resource.id, (consumers.get(value.resource.id) ?? 0) + 1);
  }

  const reader = createResourceReader(undefined, loaded.value.config.memoryBudgetMiB);
  const sourceIndexCache = createSourceIndexCache();
  reader.setConsumers(consumers);
  try {
    const uniqueResources: ResolvedReference[] = [];
    const seenResourceIds = new Set<string>();
    for (const value of resolvedResult.resolved.values()) {
      if (seenResourceIds.has(value.resource.id)) continue;
      seenResourceIds.add(value.resource.id);
      uniqueResources.push(value);
    }

    // Load each unique source before extraction. The default I/O window is bounded;
    // explicit maxConcurrency values can lower or raise that window.
    const readConcurrency = Number.isFinite(loaded.value.config.maxConcurrency)
      ? loaded.value.config.maxConcurrency
      : 4;
    try {
      await mapConcurrent(uniqueResources, readConcurrency, async (value) => {
        const reference = value.context.reference;
        if (reference === undefined) return;
        try {
          await reader.preload(value.resource, reference.source, value.resolver.id, value.context);
        } catch (cause) {
          throw new SourceLoadFailure(reference, cause);
        }
      });
    } catch (cause) {
      if (cause instanceof SourceLoadFailure) {
        diagnostics.push({
          severity: "error",
          stage: "resolve",
          message:
            cause.message +
            " " +
            (cause.cause instanceof Error ? cause.cause.message : String(cause.cause)),
          file: cause.reference.destination,
          markerLocation: cause.reference.marker.opening.location,
          source: cause.reference.source,
          cause,
        });
      } else {
        diagnostics.push({
          severity: "error",
          stage: "resolve",
          message: "Could not load source content.",
          cause,
        });
      }
      return {
        exitCode: 1,
        diagnostics,
        discoveredCount: discovery.files.length,
        plannedCount: 0,
        written: [],
        unchanged: [],
      };
    }

    const plans: DestinationPlan[] = [];
    // Resolve and plan only after every selected preparer has completed.
    // oxlint-disable no-await-in-loop
    for (const input of inputs) {
      const planned = await planDestinationFile({
        destination: input.destination,
        text: input.text,
        config: loaded.value.config,
        scan: input.scan,
        preparations: prepared.preparations,
        reader,
        resolved: resolvedResult.resolved,
        sourceIndexCache,
      });
      if (!planned.ok) diagnostics.push(planned.error);
      else plans.push(planned.value);
    }
    // oxlint-enable no-await-in-loop
    await reader.clear();

    if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return {
        exitCode: 1,
        diagnostics,
        discoveredCount: discovery.files.length,
        plannedCount: plans.length,
        written: [],
        unchanged: [],
      };
    }

    const writeResult = await writeDestinationPlans(plans);
    diagnostics.push(...writeResult.diagnostics);

    return {
      exitCode: writeResult.diagnostics.some((diagnostic) => diagnostic.severity === "error")
        ? 1
        : 0,
      diagnostics,
      discoveredCount: discovery.files.length,
      plannedCount: plans.length,
      written: writeResult.written,
      unchanged: writeResult.unchanged,
    };
  } finally {
    sourceIndexCache.clear();
    await reader.clear();
    await cleanupPreparedResources(prepared);
  }
}
