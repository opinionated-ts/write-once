export { loadWriteOnceConfig } from "./config-loader.js";
export type { LoadedWriteOnceConfig, LoadWriteOnceConfigOptions } from "./config-loader.js";
export { defineConfig, validateConfig } from "./config.js";
export type {
  NormalizedWriteOnceConfig,
  UserConfig,
  WriteOnceConfig,
  WriteOnceJsonConfig,
} from "./config.js";

export type {
  ContentExtractor,
  Diagnostic,
  DiagnosticStage,
  ExtractedContent,
  GenerationHook,
  HookContext,
  HookOutput,
  MarkerAttributes,
  MarkerBlock,
  MarkerToken,
  NamedFragmentSelector,
  PluginConfigEntry,
  PluginContribution,
  PluginFactory,
  PreparedResource,
  PreparedResourceBatch,
  RangeSelector,
  ResourcePreparationContext,
  ResourcePreparationResult,
  ResourcePreparer,
  ResolvedContent,
  ResolvedResource,
  ResourceContext,
  ResourceResolver,
  SourceReferenceContext,
  SourceLocation,
  SourceSelector,
  TextCoordinate,
  TextRange,
  TextSpan,
  WholeSourceSelector,
} from "./types.js";
