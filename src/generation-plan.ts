import { error, isFailure, ok } from "@opinionated-ts/result";

import type { NormalizedWriteOnceConfig } from "./config.js";
import type { Diagnostic } from "./types.js";
import type {
  ContentExtractor,
  ExtractedContent,
  GenerationHook,
  HookOutput,
  MarkerBlock,
  ResourceResolver,
  ResolvedResource,
  SourceSelector,
  TextSpan,
} from "./types.js";

import { ContentExtractionError } from "./errors/content-extraction-error.js";
import { namedFragmentExtractor } from "./extractors/named-fragment-extractor.js";
import { rangeExtractor } from "./extractors/range-extractor.js";
import { wholeFileExtractor } from "./extractors/whole-file-extractor.js";
import { scanMarkers } from "./marker-scanner.js";
import { localSourceResolver } from "./resolvers/local-source-resolver.js";

export interface PlanDestinationOptions {
  destination: string;
  text: string;
  config: NormalizedWriteOnceConfig;
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

function selectorFor(source: string, name?: string, range?: string): SourceSelector {
  if (name !== undefined) return { kind: "named", name };
  if (range === undefined) return { kind: "whole" };

  const match = /^(\d+):(\d+)-(\d+):(\d+)$/.exec(range);
  if (match === null) {
    throw ContentExtractionError({
      message: `Invalid source range "${range}".`,
      context: { public: { source, range } },
    });
  }

  const [, startLine, startColumn, endLine, endColumn] = match;
  return {
    kind: "range",
    range: {
      start: { line: Number(startLine), column: Number(startColumn) },
      end: { line: Number(endLine), column: Number(endColumn) },
    },
  };
}

function ordered<T extends { priority?: number }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .toSorted(
      (left, right) =>
        (right.item.priority ?? 0) - (left.item.priority ?? 0) || left.index - right.index,
    )
    .map(({ item }) => item);
}

function selectResolver(
  resolvers: readonly ResourceResolver[],
  source: string,
  context: Parameters<ResourceResolver["canResolve"]>[1],
): ResourceResolver | undefined {
  return ordered(resolvers).find((resolver) => resolver.canResolve(source, context));
}

function selectExtractor(
  extractors: readonly ContentExtractor[],
  resource: ResolvedResource,
  selector: SourceSelector,
  context: Parameters<ContentExtractor["canExtract"]>[2],
): ContentExtractor | undefined {
  return ordered(extractors).find((extractor) => extractor.canExtract(resource, selector, context));
}

function selectHook(hooks: readonly GenerationHook[]): GenerationHook | undefined {
  // V1 runs one hook per destination block: highest priority, then registration order.
  return ordered(hooks.filter((hook) => hook.stage === "pre-write"))[0];
}

function prepareBodyText(replacement: string, destination: string, span: TextSpan): string {
  const newline = /\r\n|\r|\n/.exec(destination)?.[0] ?? "\n";
  let prepared = replacement.replace(/\r\n|\r|\n/g, newline);
  const originalBody = destination.slice(span.start, span.end);
  if (/[\r\n]$/.test(originalBody) && !/[\r\n]$/.test(prepared)) prepared += newline;
  return prepared;
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

async function planBlock(
  destination: string,
  text: string,
  marker: MarkerBlock,
  config: NormalizedWriteOnceConfig,
): Promise<ReturnType<typeof ok<PlannedReplacement>> | ReturnType<typeof diagnosticError>> {
  const { source, name, range } = marker.opening.attributes;
  if (source === undefined) {
    return diagnosticError(
      "marker",
      "A generated destination must specify a source.",
      destination,
      marker,
    );
  }

  let selector: SourceSelector;
  try {
    selector = selectorFor(source, name, range);
  } catch (cause) {
    return diagnosticError(
      "marker",
      cause instanceof Error ? cause.message : String(cause),
      destination,
      marker,
      cause,
    );
  }

  const context = { cwd: config.root, destination };
  const resolvers = [...config.resolvers, localSourceResolver];
  let resolver: ResourceResolver | undefined;
  let resource: ResolvedResource;

  try {
    resolver = selectResolver(resolvers, source, context);
    if (resolver === undefined) {
      return diagnosticError(
        "resolve",
        `No resolver supports source "${source}".`,
        destination,
        marker,
      );
    }
    resource = await resolver.resolve(source, context);
  } catch (cause) {
    return diagnosticError(
      "resolve",
      `Could not resolve source "${source}".`,
      destination,
      marker,
      cause,
    );
  }

  const extractors = [
    ...config.extractors,
    namedFragmentExtractor,
    rangeExtractor,
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
    extracted = await extractor.extract(resource, selector, context);
  } catch (cause) {
    return diagnosticError(
      "extract",
      `Could not extract content from source "${source}".`,
      destination,
      marker,
      cause,
    );
  }

  let output: HookOutput = { text: extracted.text };
  const hook = selectHook(config.hooks);
  if (hook !== undefined) {
    try {
      output = await hook.run({
        stage: "pre-write",
        destination,
        marker,
        content: extracted.text,
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
  }

  const hasText = typeof output === "object" && output !== null && typeof output.text === "string";
  const hasFullText =
    typeof output === "object" && output !== null && typeof output.fullText === "string";
  if (hasText === hasFullText) {
    return diagnosticError(
      "hook",
      "Hook returned an invalid replacement value.",
      destination,
      marker,
    );
  }

  let replacement: PlannedReplacement;
  if (typeof output.fullText === "string") {
    replacement = { span: marker.span, text: output.fullText, source, selector };
  } else if (typeof output.text === "string") {
    replacement = {
      span: marker.bodySpan,
      text: prepareBodyText(output.text, text, marker.bodySpan),
      source,
      selector,
    };
  } else {
    return diagnosticError(
      "hook",
      "Hook returned an invalid replacement value.",
      destination,
      marker,
    );
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

/**
 * Prepare a destination output in memory. This function never writes files.
 * Compatible capabilities are ordered by descending priority, then registration order.
 */
export async function planDestinationFile(options: PlanDestinationOptions) {
  const { destination, text, config } = options;
  const scanned = scanMarkers(text, { resource: destination });
  if (isFailure(scanned)) {
    return error({
      severity: "error" as const,
      stage: "marker" as const,
      message: scanned.error.message,
      file: destination,
      cause: scanned.error,
    } satisfies Diagnostic);
  }

  const generated = scanned.value.blocks
    .filter((block) => block.opening.attributes.source !== undefined)
    .toSorted((left, right) => left.span.start - right.span.start);

  const replacements: PlannedReplacement[] = [];
  for (const marker of generated) {
    // Preserve source-order hook execution; hooks may have observable side effects.
    // oxlint-disable-next-line no-await-in-loop
    const planned = await planBlock(destination, text, marker, config);
    if (!planned.ok) return error(planned.error);
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
      return error({
        severity: "error" as const,
        stage: "marker" as const,
        message: "Generated destination replacements overlap.",
        file: destination,
      } satisfies Diagnostic);
    }
  }

  let outputText = text;
  for (const replacement of replacements.toSorted(
    (left, right) => right.span.start - left.span.start,
  )) {
    outputText =
      outputText.slice(0, replacement.span.start) +
      replacement.text +
      outputText.slice(replacement.span.end);
  }

  return ok({ destination, originalText: text, outputText, replacements });
}
