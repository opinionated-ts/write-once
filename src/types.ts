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

/** A manually maintained, read-only named declaration. */
export interface NamedDeclaration {
  name: string;
  marker: MarkerBlock;
  contentSpan: TextSpan;
  location: SourceLocation;
}

/** A generated destination whose content comes from a resolved source. */
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

/** A resource root materialized by a preparer for the references it serves. */
export interface PreparedResource {
  root: string;
  references: readonly SourceReferenceContext[];
  metadata?: Readonly<Record<string, unknown>>;
}

/** Resources and opaque provider data returned by one preparation batch. */
export interface ResourcePreparationResult {
  resources: readonly PreparedResource[];
  /** Provider-specific state remains opaque to the core. */
  value?: unknown;
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

/** A resource location returned by path-based resolvers; it contains no text. */
export interface ResolvedResourcePath {
  root: string;
  path: string;
  metadata?: Readonly<Record<string, unknown>>;
}

/** Resolves a source reference to a path without reading its file contents. */
export interface PathResourceResolver {
  id: string;
  canResolve(source: string, context: ResourceContext): boolean;
  resolve(
    source: string,
    context: ResourceContext,
  ): ResolvedResourcePath | Promise<ResolvedResourcePath>;
}

/**
 * A resource resolved for extraction.
 *
 * `location` and `id` are opaque identifiers to the core. A resolver may
 * supply text directly or provide metadata required by a compatible extractor.
 */
export type ResolvedResource = {
  id: string;
  location: string;
} & (
  | { text: string; metadata?: Readonly<Record<string, unknown>> }
  | { text?: string; metadata: Readonly<Record<string, unknown>> }
);

/** Shared information available while resolving or extracting a resource. */
export interface ResourceContext {
  cwd: string;
  destination?: string;
  metadata?: Readonly<Record<string, unknown>>;
  preparations?: readonly ResourcePreparationResult[];
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
 * Selects content from an already resolved resource.
 *
 * Extractors do not acquire resources or write destination files. The first
 * compatible extractor in registration order is selected.
 */
export interface ContentExtractor {
  id: string;
  canExtract(
    resource: ResolvedResource,
    selector: SourceSelector,
    context: ResourceContext,
  ): boolean;
  extract(
    resource: ResolvedResource,
    selector: SourceSelector,
    context: ResourceContext,
  ): ExtractedContent | Promise<ExtractedContent>;
}

/** A stage in the generation pipeline. Custom stages remain possible. */
export type DiagnosticStage =
  | "config"
  | "discovery"
  | "marker"
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
  /** Extracted source text before the hook runs. */
  content: string;
  /** Original source reference from the destination marker. */
  sourceReference?: string;
  /** Selector used to extract content from the resolved resource. */
  selector?: SourceSelector;
  /** Resolved resource, including metadata supplied by its resolver. */
  source?: ResolvedResource;
}

/** Body-only text preserves marker lines; fullText replaces the complete block. */
export type HookOutput = { text: string; fullText?: never } | { fullText: string; text?: never };

/**
 * Customizes content at a named generation stage.
 *
 * Hooks may be synchronous or asynchronous. The first hook registered for a
 * supported stage is selected. A hook must return an explicit replacement scope.
 */
export interface GenerationHook {
  id: string;
  stage: string;
  run(context: HookContext): HookOutput | Promise<HookOutput>;
}
