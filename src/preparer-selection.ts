import type { ResourceContext, ResourcePreparer, SourceReferenceContext } from "./types.js";

export class PreparerTriggerError extends Error {
  constructor(
    readonly preparerId: string,
    readonly reference: SourceReferenceContext,
    cause: unknown,
  ) {
    super(`Preparer trigger "${preparerId}" failed for source "${reference.source}".`, { cause });
    this.name = "PreparerTriggerError";
  }
}

// Select the first preparer whose synchronous trigger accepts a reference.
export function selectPreparer(
  preparers: readonly ResourcePreparer[],
  reference: SourceReferenceContext,
  context: ResourceContext,
): ResourcePreparer | undefined {
  for (const preparer of preparers) {
    let matches: boolean;
    try {
      matches = preparer.canPrepare(reference, context);
    } catch (cause) {
      throw new PreparerTriggerError(preparer.id, reference, cause);
    }
    if (matches) return preparer;
  }
  return undefined;
}

export interface PreparerReferenceAssignments {
  batches: Array<{ preparer: ResourcePreparer; references: SourceReferenceContext[] }>;
  unassigned: SourceReferenceContext[];
}

// Group references by their first matching preparer without invoking preparation.
export function assignPreparerReferences(
  preparers: readonly ResourcePreparer[],
  references: readonly SourceReferenceContext[],
  contextFor: (reference: SourceReferenceContext) => ResourceContext,
): PreparerReferenceAssignments {
  const assigned = new Map<ResourcePreparer, SourceReferenceContext[]>();
  const unassigned: SourceReferenceContext[] = [];

  for (const reference of references) {
    const preparer = selectPreparer(preparers, reference, contextFor(reference));
    if (preparer === undefined) {
      unassigned.push(reference);
      continue;
    }

    const batch = assigned.get(preparer) ?? [];
    batch.push(reference);
    assigned.set(preparer, batch);
  }

  return {
    batches: preparers.flatMap((preparer) => {
      const batch = assigned.get(preparer);
      return batch === undefined ? [] : [{ preparer, references: batch }];
    }),
    unassigned,
  };
}
