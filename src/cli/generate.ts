import { isFailure } from "@opinionated-ts/result";
import { readFile } from "node:fs/promises";

import type { Diagnostic } from "../types.js";

import { loadWriteOnceConfig } from "../config-loader.js";
import { discoverDestinationFiles } from "../discovery.js";
import {
  planDestinationFile,
  scanDestinationFile,
  type DestinationPlan,
  type DestinationScan,
} from "../generation-plan.js";
import {
  cleanupPreparedResources,
  prepareSourceReferences,
  ResourcePreparationFailure,
} from "../resource-preparation.js";
import { writeDestinationPlans } from "../safe-write.js";

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

/** Run generation without coupling command output to the pipeline. */
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

  const inputs: Array<{ destination: string; text: string; scan: DestinationScan }> = [];
  // Read and scan each destination once before discovering preparer batches.
  // oxlint-disable no-await-in-loop
  for (const destination of discovery.files) {
    let text: string;
    try {
      text = await readFile(destination, "utf8");
    } catch (cause) {
      diagnostics.push({
        severity: "error",
        stage: "generate",
        message: `Could not read destination: ${cause instanceof Error ? cause.message : String(cause)}`,
        file: destination,
        cause,
      });
      continue;
    }

    const scan = scanDestinationFile(destination, text);
    if (!scan.ok) diagnostics.push(scan.error);
    else inputs.push({ destination, text, scan: scan.value });
  }
  // oxlint-enable no-await-in-loop

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

  try {
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
      });
      if (!planned.ok) diagnostics.push(planned.error);
      else plans.push(planned.value);
    }
    // oxlint-enable no-await-in-loop

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
    await cleanupPreparedResources(prepared);
  }
}
