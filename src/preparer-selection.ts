import type { ResourceContext, ResourcePreparer, SourceReferenceContext } from "./types.js";

/** Select the first preparer whose synchronous trigger accepts a reference. */
export function selectPreparer(
  preparers: readonly ResourcePreparer[],
  reference: SourceReferenceContext,
  context: ResourceContext,
): ResourcePreparer | undefined {
  return preparers.find((preparer) => preparer.canPrepare(reference, context));
}
