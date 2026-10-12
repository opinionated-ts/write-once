import { randomUUID } from "node:crypto";
import { chmod, open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import type { DestinationPlan } from "./generation-plan.js";
import type { Diagnostic } from "./types.js";

export interface SafeWriteResult {
  written: string[];
  unchanged: string[];
  diagnostics: Diagnostic[];
}

interface StagedFile {
  destination: string;
  temporary: string;
}

function writeDiagnostic(message: string, file: string, cause?: unknown): Diagnostic {
  return {
    severity: "error",
    stage: "write",
    message,
    file,
    ...(cause === undefined ? {} : { cause }),
  };
}

async function cleanupTemporaryFiles(files: readonly StagedFile[]): Promise<void> {
  await Promise.all(
    files.map(async ({ temporary }) => {
      try {
        await rm(temporary, { force: true });
      } catch {
        // Preserve the primary error.
      }
    }),
  );
}

/** Atomically replace changed destination files using temporary sibling files. */
export async function writeDestinationPlans(
  plans: readonly DestinationPlan[],
): Promise<SafeWriteResult> {
  const written: string[] = [];
  const unchanged: string[] = [];
  const diagnostics: Diagnostic[] = [];
  const destinations = plans.map((plan) => resolve(plan.destination));

  if (new Set(destinations).size !== destinations.length) {
    return {
      written,
      unchanged,
      diagnostics: [
        writeDiagnostic(
          "A destination appears more than once in the write plan.",
          destinations[0] ?? process.cwd(),
        ),
      ],
    };
  }

  const staged: StagedFile[] = [];
  try {
    // oxlint-disable no-await-in-loop
    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index]!;
      const destination = destinations[index]!;
      const current = await readFile(destination, "utf8");
      if (current !== plan.originalText) {
        diagnostics.push(
          writeDiagnostic(
            "Destination changed after planning; refusing to overwrite newer content.",
            destination,
          ),
        );
        continue;
      }
      if (plan.outputText === current) {
        unchanged.push(destination);
        continue;
      }

      const fileStat = await stat(destination);
      const temporary = join(
        dirname(destination),
        `.${basename(destination)}.write-once-${randomUUID()}.tmp`,
      );
      const handle = await open(temporary, "wx", fileStat.mode & 0o7777);
      staged.push({ destination, temporary });
      try {
        await handle.writeFile(plan.outputText, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await chmod(temporary, fileStat.mode & 0o7777);
    }
    // oxlint-enable no-await-in-loop
  } catch (cause) {
    await cleanupTemporaryFiles(staged);
    return {
      written,
      unchanged,
      diagnostics: [
        writeDiagnostic(
          `Could not stage destination output; no destination files were replaced: ${cause instanceof Error ? cause.message : String(cause)}`,
          staged.at(-1)?.destination ?? destinations[0] ?? process.cwd(),
          cause,
        ),
      ],
    };
  }

  if (diagnostics.length > 0) {
    await cleanupTemporaryFiles(staged);
    return { written, unchanged, diagnostics };
  }

  // oxlint-disable no-await-in-loop
  for (let index = 0; index < staged.length; index += 1) {
    const file = staged[index]!;
    try {
      await rename(file.temporary, file.destination);
      written.push(file.destination);
    } catch (cause) {
      await cleanupTemporaryFiles(staged.slice(index));
      diagnostics.push(
        writeDiagnostic(
          `Could not replace "${file.destination}" after ${written.length} earlier write(s). Earlier writes were not rolled back: ${cause instanceof Error ? cause.message : String(cause)}`,
          file.destination,
          cause,
        ),
      );
      break;
    }
  }
  // oxlint-enable no-await-in-loop

  return { written, unchanged, diagnostics };
}
