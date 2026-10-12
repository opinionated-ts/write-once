export { wholeFileExtractor } from "./extractors/whole-file-extractor.js";
export { localSourceResolver } from "./resolvers/local-source-resolver.js";
export { scanMarkers } from "./marker-scanner.js";
export type { MarkerScanResult, ScanMarkersOptions } from "./marker-scanner.js";
export { parseMarkerLine } from "./marker-parser.js";
export type { ParseMarkerLineOptions } from "./marker-parser.js";

export type {
  ContentExtractor,
  Diagnostic,
  DiagnosticStage,
  ExtractedContent,
  GeneratedDestination,
  GenerationHook,
  HookContext,
  HookOutput,
  MarkerAttributes,
  MarkerBlock,
  MarkerToken,
  NamedDeclaration,
  NamedFragmentSelector,
  PluginContribution,
  RangeSelector,
  ResolvedResource,
  ResourceContext,
  ResourceResolver,
  SourceLocation,
  SourceSelector,
  TextCoordinate,
  TextRange,
  TextSpan,
  WholeSourceSelector,
} from "./types.js";
