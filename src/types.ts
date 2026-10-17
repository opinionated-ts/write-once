import type { Result } from "@opinionated-ts/result";

/**
 * A half-open span in a JavaScript string, measured in UTF-16 code units.
 *
 * The start offset is inclusive and the end offset is exclusive.
 */
export interface TextSpan {
  start: number;
  end: number;
}

/**
 * A human-facing text coordinate.
 *
 * Lines and columns are 1-based. Columns count UTF-16 code units.
 */
export interface TextCoordinate {
  line: number;
  column: number;
}

/**
 * Identifies a location within a resource.
 *
 * The resource identifier is intentionally not restricted to a local file path.
 */
export interface SourceLocation {
  resource: string;
  start: TextCoordinate;
  end: TextCoordinate;
}

/**
 * The semantic attributes understood by the marker parser.
 *
 * Wrapper syntax and unrelated attributes are deliberately excluded.
 */
export interface MarkerAttributes {
  source?: string;
  name?: string;
  range?: string;
}

/**
 * The source-text offsets and location of a marker token.
 *
 * `span` covers the marker token; `lineSpan` covers its complete delimiter
 * line, including its line ending when present.
 */
export interface MarkerToken {
  kind: "open" | "close";
  raw: string;
  attributes: MarkerAttributes;
  span: TextSpan;
  lineSpan: TextSpan;
  location: SourceLocation;
}

/**
 * A paired marker block. Delimiter lines are preserved by default; only
 * `bodySpan` is replaced during normal generation.
 */
export interface MarkerBlock {
  opening: MarkerToken;
  closing: MarkerToken;
  span: TextSpan;
  bodySpan: TextSpan;
}

/** A line-and-column range in a resource. The end coordinate is exclusive. */
export interface TextRange {
  start: TextCoordinate;
  end: TextCoordinate;
}

/** Selects the complete source resource. */
export interface WholeSourceSelector {
  kind: "whole";
}

/** Selects a named declaration from the resolved source resource. */
export interface NamedFragmentSelector {
  kind: "named";
  name: string;
}

/** Selects a range from the resolved source resource. */
export interface RangeSelector {
  kind: "range";
  range: TextRange;
}

/** The built-in source-selection modes supported by v1. */
export type SourceSelector = WholeSourceSelector | NamedFragmentSelector | RangeSelector;

// A manually maintained, read-only named declaration.
export interface NamedDeclaration {
  name: string;
  marker: MarkerBlock;
  contentSpan: TextSpan;
  location: SourceLocation;
}

// A generated destination whose content comes from a resolved source.
export interface GeneratedDestination {
  source: string;
  selector: SourceSelector;
  marker: MarkerBlock;
  location: SourceLocation;
}

/**
 * Optional capabilities contributed by a plugin.
 *
 * Capability types are generic so resolver, extractor, and hook contracts can
 * evolve independently. A plugin may contribute any subset of these arrays.
 */
export interface PluginContribution<
  Resolver = ResourceResolver,
  Extractor = ContentExtractor,
  Hook = GenerationHook,
  Preparer = ResourcePreparer,
> {
  name?: string;
  preparers?: readonly Preparer[];
  resolvers?: readonly Resolver[];
  extractors?: readonly Extractor[];
  hooks?: readonly Hook[];
}

/** A source reference and the destination context in which it was declared. */
export interface SourceReferenceContext {
  source: string;
  selector: SourceSelector;
  destination: string;
  marker: MarkerBlock;
}

/** Context supplied to a preparer for one generation run. */
export interface ResourcePreparationContext {
  cwd: string;
  /** A Write Once-managed directory reserved for this preparer's resources. */
  workingDirectory: string;
}

/** A resource root materialized by a preparation batch. */
export interface PreparedResource {
  root: string;
  /** Provider-specific state for this resource, distinct from batch metadata. */
  metadata?: Readonly<Record<string, unknown>>;
}

/** Resources and provider-specific metadata returned by one preparation batch. */
export interface ResourcePreparationResult {
  resources: readonly PreparedResource[];
  /** Provider-specific state shared by the entire preparation batch. */
  metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Selects source references synchronously, then prepares their resources in a
 * single async-capable batch per generation run.
 */
export interface ResourcePreparer {
  id: string;
  canPrepare(reference: SourceReferenceContext, context: ResourceContext): boolean;
  prepare(
    references: readonly SourceReferenceContext[],
    context: ResourcePreparationContext,
  ): ResourcePreparationResult | Promise<ResourcePreparationResult>;
}

/** A resolved resource location. Resolver output never contains file contents. */
export interface ResolvedResource {
  readonly root: string;
  readonly path: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** A resolved resource after the core has loaded its contents. */
export interface ResolvedContent extends ResolvedResource {
  readonly id: string;
  readonly location: string;
  /** Shared source text is immutable by contract and must not be changed by extractors. */
  readonly text: string;
}

/** A preparer's opaque result paired with the references assigned to it. */
export interface PreparedResourceBatch {
  preparerId: string;
  workingDirectory: string;
  references: readonly SourceReferenceContext[];
  result: ResourcePreparationResult;
}

export interface ResourceContext {
  cwd: string;
  destination?: string;
  reference?: SourceReferenceContext;
  metadata?: Readonly<Record<string, unknown>>;
  preparation?: PreparedResourceBatch;
}

/** The selected text and its location within the source resource, when known. */
export interface ExtractedContent {
  text: string;
  location?: SourceLocation;
  metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Finds or acquires a resource for a source reference.
 *
 * Resolvers do not choose which content is extracted. The first compatible
 * resolver in registration order is selected.
 */
export interface ResourceResolver {
  id: string;
  canResolve(source: string, context: ResourceContext): boolean;
  resolve(source: string, context: ResourceContext): ResolvedResource | Promise<ResolvedResource>;
}

/**
 * Selects content from a resolved resource with already-loaded, read-only text.
 *
 * Extractors must not mutate source text, perform resource I/O, or write destination
 * files. The first compatible extractor in registration order is selected.
 */
export interface ContentExtractor {
  id: string;
  canExtract(
    resource: ResolvedContent,
    selector: SourceSelector,
    context: ResourceContext,
  ): boolean;
  extract(
    resource: ResolvedContent,
    selector: SourceSelector,
    context: ResourceContext,
  ): ExtractedContent | Promise<ExtractedContent>;
  /** Explicit Result contract used by built-in extractors in the pipeline. */
  extractResult?(
    resource: ResolvedContent,
    selector: SourceSelector,
    context: ResourceContext,
  ): Result<ExtractedContent> | Promise<Result<ExtractedContent>>;
}

/** A stage in the generation pipeline. Custom stages remain possible. */
export type DiagnosticStage =
  | "config"
  | "discovery"
  | "marker"
  | "prepare"
  | "resolve"
  | "extract"
  | "hook"
  | "write"
  | "generate"
  | (string & {});

/** A structured, actionable issue encountered during processing. */
export interface Diagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  stage: DiagnosticStage;
  code?: string;
  file?: string;
  markerLocation?: SourceLocation;
  source?: string;
  cause?: unknown;
}

/** Context provided to a hook that customizes generated content. */
export interface HookContext {
  /** Pipeline lifecycle stage; v1 executes the pre-write stage. */
  stage: string;
  /** Destination file being planned. */
  destination: string;
  /** Exact marker tokens, delimiter-line spans, body span, and full block span. */
  marker: MarkerBlock;
  /** Current generated body text. */
  text: string;
  /** Current complete generated block, including its marker delimiters. */
  fullText: string;
  /** Original source reference from the destination marker. */
  sourceReference?: string;
  /** Selector used to extract content from the resolved resource. */
  selector?: SourceSelector;
  /** Resolved resource, including metadata supplied by its resolver. */
  source?: ResolvedContent;
}

/** A hook may replace the body, the complete block, or both representations. */
export type HookOutput = { text?: string; fullText?: string };

/**
 * Customizes content at a named generation stage.
 *
 * Hooks may be synchronous or asynchronous. All hooks for a supported stage run
 * in registration order. A hook must return at least one replacement representation.
 */
export interface GenerationHook {
  id: string;
  stage: string;
  run(context: HookContext): HookOutput | Promise<HookOutput>;
}
