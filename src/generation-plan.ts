import { error, isFailure, ok } from "@opinionated-ts/result";

import type { NormalizedWriteOnceConfig } from "./config.js";
import type { Diagnostic } from "./types.js";
import type {
  ContentExtractor,
  ExtractedContent,
  GenerationHook,
  HookOutput,
  MarkerBlock,
  PreparedResourceBatch,
  ResourceResolver,
  ResolvedContent,
  ResourceContext,
  SourceReferenceContext,
  SourceSelector,
  TextSpan,
} from "./types.js";

import { mapConcurrent } from "./async-pool.js";
import { ContentExtractionError } from "./errors/content-extraction-error.js";
import { createNamedFragmentExtractor } from "./extractors/named-fragment-extractor.js";
import { createRangeExtractor } from "./extractors/range-extractor.js";
import { wholeFileExtractor } from "./extractors/whole-file-extractor.js";
import { scanMarkers } from "./marker-scanner.js";
import { localSourceResolver } from "./resolvers/local-source-resolver.js";
import { normalizeResolvedResource } from "./resource-path.js";
import { createResourceReader, type ResourceReader } from "./resource-reader.js";
import { createSourceIndexCache, type SourceIndexCache } from "./source-index-cache.js";

export interface PlanDestinationOptions {
  destination: string;
  text: string;
  config: NormalizedWriteOnceConfig;
  scan?: DestinationScan;
  preparations?: readonly PreparedResourceBatch[];
  reader?: ResourceReader;
  resolved?: ReadonlyMap<string, ResolvedReference>;
  // Internal derived indexes shared for the lifetime of one generation run.
  sourceIndexCache?: SourceIndexCache;
}

export interface DestinationScan {
  references: SourceReferenceContext[];
}

export interface ResolvedReference {
  resolver: ResourceResolver;
  resource: Awaited<ReturnType<typeof normalizeResolvedResource>>;
  context: ResourceContext;
}

export interface PlannedReplacement {
  span: TextSpan;
  text: string;
  source: string;
  selector: SourceSelector;
}

export interface DestinationPlan {
  destination: string;
  originalText: string;
  outputText: string;
  replacements: PlannedReplacement[];
}

type DiagnosticFailure = ReturnType<typeof error<Diagnostic>>;

function markerErrorLocation(cause: unknown, destination: string): Diagnostic["markerLocation"] {
  if (typeof cause !== "object" || cause === null || !("context" in cause)) return undefined;
  const context = cause.context;
  if (typeof context !== "object" || context === null || !("public" in context)) return undefined;
  const details = context.public;
  if (typeof details !== "object" || details === null) return undefined;
  const { line, column } = details as { line?: unknown; column?: unknown };
  if (
    typeof line !== "number" ||
    !Number.isSafeInteger(line) ||
    line < 1 ||
    typeof column !== "number" ||
    !Number.isSafeInteger(column) ||
    column < 1
  ) {
    return undefined;
  }

  return {
    resource: destination,
    start: { line, column },
    end: { line, column },
  };
}

function diagnosticError(
  stage: Diagnostic["stage"],
  message: string,
  destination: string,
  marker: MarkerBlock,
  cause?: unknown,
): DiagnosticFailure {
  return error({
    severity: "error" as const,
    stage,
    message,
    file: destination,
    markerLocation: marker.opening.location,
    ...(marker.opening.attributes.source === undefined
      ? {}
      : { source: marker.opening.attributes.source }),
    ...(cause === undefined ? {} : { cause }),
  } satisfies Diagnostic);
}

export function selectorFor(source: string, name?: string, range?: string) {
  if (name !== undefined) return ok<SourceSelector>({ kind: "named", name });
  if (range === undefined) return ok<SourceSelector>({ kind: "whole" });

  const match = /^(\d+):(\d+)-(\d+):(\d+)$/.exec(range);
  if (match === null) {
    return error(
      ContentExtractionError({
        message: "Invalid source range " + JSON.stringify(range) + ".",
        context: { public: { source, range } },
      }),
    );
  }

  const [, startLine, startColumn, endLine, endColumn] = match;
  return ok<SourceSelector>({
    kind: "range",
    range: {
      start: { line: Number(startLine), column: Number(startColumn) },
      end: { line: Number(endLine), column: Number(endColumn) },
    },
  });
}

// Scan one destination once and collect source references with selector context.
export function scanDestinationFile(destination: string, text: string) {
  const scanned = scanMarkers(text, { resource: destination });
  if (isFailure(scanned)) {
    return error({
      severity: "error" as const,
      stage: "marker" as const,
      message: scanned.error.message,
      file: destination,
      markerLocation: markerErrorLocation(scanned.error, destination),
      cause: scanned.error,
    } satisfies Diagnostic);
  }

  const generated = scanned.value.blocks
    .filter((block) => block.opening.attributes.source !== undefined)
    .toSorted((left, right) => left.span.start - right.span.start);
  const references: SourceReferenceContext[] = [];

  for (const marker of generated) {
    const { source, name, range } = marker.opening.attributes;
    if (source === undefined) continue;

    const selector = selectorFor(source, name, range);
    if (isFailure(selector)) {
      return diagnosticError("marker", selector.error.message, destination, marker, selector.error);
    }
    references.push({ source, selector: selector.value, destination, marker });
  }

  return ok({ references });
}

function selectResolver(
  resolvers: readonly ResourceResolver[],
  source: string,
  context: Parameters<ResourceResolver["canResolve"]>[1],
): ResourceResolver | undefined {
  return resolvers.find((resolver) => resolver.canResolve(source, context));
}

function selectExtractor(
  extractors: readonly ContentExtractor[],
  resource: ResolvedContent,
  selector: SourceSelector,
  context: Parameters<ContentExtractor["canExtract"]>[2],
): ContentExtractor | undefined {
  return extractors.find((extractor) => extractor.canExtract(resource, selector, context));
}

function selectHooks(hooks: readonly GenerationHook[]): readonly GenerationHook[] {
  return hooks.filter((hook) => hook.stage === "pre-write");
}

interface HookState {
  text: string;
  fullText: string;
  fullTextBodySpan: TextSpan;
  fullTextChanged: boolean;
}

function bodySpanWithinBlock(marker: MarkerBlock): TextSpan {
  return {
    start: marker.bodySpan.start - marker.span.start,
    end: marker.bodySpan.end - marker.span.start,
  };
}

function splitHookFullText(
  fullText: string,
  destination: string,
): { text: string; bodySpan: TextSpan } {
  const scanned = scanMarkers(fullText, { resource: destination });
  if (scanned.ok) {
    const generatedBlocks = scanned.value.blocks.filter(
      (block) => block.opening.attributes.source !== undefined,
    );
    if (generatedBlocks.length === 1) {
      const block = generatedBlocks[0]!;
      return {
        text: fullText.slice(block.bodySpan.start, block.bodySpan.end),
        bodySpan: block.bodySpan,
      };
    }
  }

  const firstLineEnd = fullText.search(/\r?\n/);
  if (firstLineEnd < 0) {
    return { text: fullText, bodySpan: { start: 0, end: fullText.length } };
  }
  const newlineLength = fullText[firstLineEnd] === "\r" ? 2 : 1;
  const lastNewlineStart = Math.max(fullText.lastIndexOf("\n"), fullText.lastIndexOf("\r"));
  const bodyStart = firstLineEnd + newlineLength;
  if (lastNewlineStart <= bodyStart) {
    return { text: "", bodySpan: { start: bodyStart, end: bodyStart } };
  }

  return {
    text: fullText.slice(bodyStart, lastNewlineStart),
    bodySpan: { start: bodyStart, end: lastNewlineStart },
  };
}

function prepareBodyText(replacement: string, destination: string): string {
  const newline = /\r\n|\r|\n/.exec(destination)?.[0] ?? "\n";
  let prepared = replacement.replace(/\r\n|\r|\n/g, newline);
  if (prepared.length > 0 && !/[\r\n]$/.test(prepared)) prepared += newline;
  return prepared;
}

function replaceSpan(text: string, span: TextSpan, replacement: string): string {
  return text.slice(0, span.start) + replacement + text.slice(span.end);
}

function prepareExistingBodyText(text: string, span: TextSpan, replacement: string): string {
  const newline = /\r\n|\r|\n/.exec(text)?.[0] ?? "\n";
  const normalized = replacement.replace(/\r\n|\r|\n/g, newline);
  const existingBody = text.slice(span.start, span.end);
  if (/[\r\n]$/.test(existingBody)) {
    return /[\r\n]$/.test(normalized) ? normalized : normalized + newline;
  }
  return normalized.replace(/[\r\n]+$/, "");
}

function validSpan(span: TextSpan, length: number): boolean {
  return (
    Number.isSafeInteger(span.start) &&
    Number.isSafeInteger(span.end) &&
    span.start >= 0 &&
    span.start <= span.end &&
    span.end <= length
  );
}

function referenceKey(reference: SourceReferenceContext): string {
  return reference.destination + "\0" + reference.marker.span.start + "\0" + reference.source;
}

export async function resolveSourceReferences(
  references: readonly SourceReferenceContext[],
  config: NormalizedWriteOnceConfig,
  preparations: readonly PreparedResourceBatch[],
): Promise<{ resolved: Map<string, ResolvedReference>; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const resolved = new Map<string, ResolvedReference>();
  const resolvers = [...config.resolvers, localSourceResolver];

  // Build the reference-to-batch index once instead of scanning every batch for every resolver candidate.
  const preparationByReference = new Map<string, PreparedResourceBatch>();
  for (const preparation of preparations) {
    for (const reference of preparation.references) {
      preparationByReference.set(referenceKey(reference), preparation);
    }
  }

  const outcomes = await mapConcurrent(references, config.maxConcurrency, async (reference) => {
    const { source, destination, marker } = reference;
    const assignedPreparation = preparationByReference.get(referenceKey(reference));
    const context: ResourceContext = {
      cwd: config.root,
      destination,
      reference,
      preparation:
        assignedPreparation === undefined
          ? undefined
          : {
              preparerId: assignedPreparation.preparerId,
              workingDirectory: assignedPreparation.workingDirectory,
              result: assignedPreparation.result,
            },
    };
    let resolver: ResourceResolver | undefined;
    try {
      resolver = selectResolver(resolvers, source, context);
      if (resolver === undefined) {
        return {
          key: referenceKey(reference),
          diagnostic: diagnosticError(
            "resolve",
            'No resolver supports source "' + source + '".',
            destination,
            marker,
          ),
        };
      }
      const result = await resolver.resolve(source, context);
      const normalized = await normalizeResolvedResource(result, source, resolver.id, context);
      return {
        key: referenceKey(reference),
        value: { resolver, resource: normalized, context } satisfies ResolvedReference,
      };
    } catch (cause) {
      const reason = cause instanceof Error ? ` ${cause.message}` : "";
      return {
        key: referenceKey(reference),
        diagnostic: diagnosticError(
          "resolve",
          'Resolver "' +
            (resolver?.id ?? "selection") +
            '" could not resolve source "' +
            source +
            '".' +
            reason,
          destination,
          marker,
          cause,
        ),
      };
    }
  });

  for (const outcome of outcomes) {
    if ("value" in outcome && outcome.value !== undefined) {
      resolved.set(outcome.key, outcome.value);
    } else if ("diagnostic" in outcome && outcome.diagnostic !== undefined) {
      diagnostics.push(outcome.diagnostic.error);
    }
  }
  return { resolved, diagnostics };
}

async function planBlock(
  destination: string,
  text: string,
  reference: SourceReferenceContext,
  config: NormalizedWriteOnceConfig,
  reader: ResourceReader,
  resolvedReference: ResolvedReference,
  sourceIndexCache: SourceIndexCache,
): Promise<ReturnType<typeof ok<PlannedReplacement>> | ReturnType<typeof diagnosticError>> {
  const { source, selector, marker } = reference;
  const { resolver, resource: normalized, context } = resolvedReference;
  let resource: Awaited<ReturnType<ResourceReader["read"]>>;
  try {
    resource = await reader.read(normalized, source, resolver.id, context);
  } catch (cause) {
    return diagnosticError(
      "resolve",
      'Could not load source "' +
        source +
        '": ' +
        (cause instanceof Error ? cause.message : String(cause)),
      destination,
      marker,
      cause,
    );
  }

  const extractors = [
    ...config.extractors,
    createNamedFragmentExtractor(sourceIndexCache),
    createRangeExtractor(sourceIndexCache),
    wholeFileExtractor,
  ];
  let extractor: ContentExtractor | undefined;
  let extracted: ExtractedContent;

  try {
    extractor = selectExtractor(extractors, resource, selector, context);
    if (extractor === undefined) {
      return diagnosticError(
        "extract",
        `No extractor supports selector "${selector.kind}" for source "${source}".`,
        destination,
        marker,
      );
    }
    if (extractor.extractResult !== undefined) {
      const extraction = await extractor.extractResult(resource, selector, context);
      if (isFailure(extraction)) {
        return diagnosticError(
          "extract",
          "Could not extract content from source " + JSON.stringify(source) + ".",
          destination,
          marker,
          extraction.error,
        );
      }
      extracted = extraction.value;
    } else {
      extracted = await extractor.extract(resource, selector, context);
    }
  } catch (cause) {
    return diagnosticError(
      "extract",
      `Could not extract content from source "${source}".`,
      destination,
      marker,
      cause,
    );
  }

  const originalFullText = text.slice(marker.span.start, marker.span.end);
  let hookState: HookState = {
    text: extracted.text,
    fullText: originalFullText,
    fullTextBodySpan: bodySpanWithinBlock(marker),
    fullTextChanged: false,
  };

  for (const hook of selectHooks(config.hooks)) {
    let output: HookOutput;
    try {
      // Hooks are intentionally sequential: each receives the previous hook's state.
      // oxlint-disable-next-line no-await-in-loop
      output = await hook.run({
        stage: "pre-write",
        destination,
        marker,
        text: hookState.text,
        fullText: hookState.fullText,
        sourceReference: source,
        selector,
        source: resource,
      });
    } catch (cause) {
      return diagnosticError(
        "hook",
        `Pre-write hook "${hook.id}" failed.`,
        destination,
        marker,
        cause,
      );
    }

    const hasText = typeof output?.text === "string";
    const hasFullText = typeof output?.fullText === "string";
    if (!hasText && !hasFullText) {
      return diagnosticError(
        "hook",
        `Hook "${hook.id}" must return text, fullText, or both.`,
        destination,
        marker,
      );
    }

    if (hasFullText) {
      try {
        const split = splitHookFullText(output.fullText!, destination);
        hookState = {
          text: hasText ? output.text! : split.text,
          fullText: output.fullText!,
          fullTextBodySpan: split.bodySpan,
          fullTextChanged: output.fullText !== originalFullText,
        };
      } catch (cause) {
        return diagnosticError(
          "hook",
          `Hook "${hook.id}" returned invalid fullText.`,
          destination,
          marker,
          cause,
        );
      }
    } else {
      hookState = {
        ...hookState,
        text: output.text!,
      };
    }
  }

  let replacement: PlannedReplacement;
  if (hookState.fullTextChanged) {
    const fullText = replaceSpan(
      hookState.fullText,
      hookState.fullTextBodySpan,
      prepareExistingBodyText(hookState.fullText, hookState.fullTextBodySpan, hookState.text),
    );
    replacement = { span: marker.span, text: fullText, source, selector };
  } else {
    replacement = {
      span: marker.bodySpan,
      text: prepareBodyText(hookState.text, text),
      source,
      selector,
    };
  }

  if (!validSpan(replacement.span, text.length)) {
    return diagnosticError(
      "hook",
      "Hook replacement span is outside the destination file.",
      destination,
      marker,
    );
  }

  return ok(replacement);
}

// Prepare a destination output in memory. This function never writes files.
// Compatible capabilities are selected in registration order.
export async function planDestinationFile(options: PlanDestinationOptions) {
  const { destination, text, config } = options;
  const scan =
    options.scan === undefined ? scanDestinationFile(destination, text) : ok(options.scan);
  if (!scan.ok) {
    return error(scan.error);
  }

  const preparations = options.preparations ?? [];
  const ownsReader = options.reader === undefined;
  const reader = options.reader ?? createResourceReader(undefined, config.memoryBudgetMiB);
  const sourceIndexCache = options.sourceIndexCache ?? createSourceIndexCache();
  const resolvedResult =
    options.resolved === undefined
      ? await resolveSourceReferences(scan.value.references, config, preparations)
      : { resolved: options.resolved, diagnostics: [] as Diagnostic[] };
  if (resolvedResult.diagnostics.length > 0) {
    if (ownsReader) await reader.clear();
    return error(resolvedResult.diagnostics[0]!);
  }
  if (options.resolved === undefined) {
    const consumers = new Map<string, number>();
    for (const value of resolvedResult.resolved.values()) {
      consumers.set(value.resource.id, (consumers.get(value.resource.id) ?? 0) + 1);
    }
    reader.setConsumers(consumers);
  }
  const replacements: PlannedReplacement[] = [];
  for (const reference of scan.value.references) {
    const resolvedReference = resolvedResult.resolved.get(referenceKey(reference));
    if (resolvedReference === undefined) continue;
    // Preserve source-order hook execution; hooks may have observable side effects.
    // oxlint-disable-next-line no-await-in-loop
    let planned: Awaited<ReturnType<typeof planBlock>>;
    try {
      // oxlint-disable-next-line no-await-in-loop
      planned = await planBlock(
        destination,
        text,
        reference,
        config,
        reader,
        resolvedReference,
        sourceIndexCache,
      );
    } finally {
      // oxlint-disable-next-line no-await-in-loop
      await reader.release(resolvedReference.resource.id);
    }
    if (!planned.ok) {
      // oxlint-disable-next-line no-await-in-loop
      if (ownsReader) await reader.clear();
      return error(planned.error);
    }
    replacements.push(planned.value);
  }

  const byStart = replacements.toSorted((left, right) => left.span.start - right.span.start);
  for (let index = 1; index < byStart.length; index += 1) {
    const previous = byStart[index - 1]!;
    const current = byStart[index]!;
    if (
      current.span.start < previous.span.end ||
      (current.span.start === previous.span.start && current.span.end === previous.span.end)
    ) {
      // oxlint-disable-next-line no-await-in-loop
      if (ownsReader) await reader.clear();
      return error({
        severity: "error" as const,
        stage: "marker" as const,
        message: "Generated destination replacements overlap.",
        file: destination,
      } satisfies Diagnostic);
    }
  }

  const outputParts: string[] = [];
  let cursor = 0;
  for (const replacement of byStart) {
    outputParts.push(text.slice(cursor, replacement.span.start), replacement.text);
    cursor = replacement.span.end;
  }
  outputParts.push(text.slice(cursor));
  const outputText = outputParts.join("");

  if (ownsReader) await reader.clear();
  return ok({ destination, originalText: text, outputText, replacements });
}
