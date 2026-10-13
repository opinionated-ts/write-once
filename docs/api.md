# Public TypeScript API

The package root exports the config loader, config validator, and contracts intended for programmatic configuration and third-party extensions. Parsing, discovery, extraction, planning, and writing helpers are internal implementation details, not stable root exports.

## Configuration

- `WriteOnceConfig` describes optional `root`, `include`, `exclude`, `respectGitignore`, `maxConcurrency`, `memoryBudgetMiB`, `preparers`, `resolvers`, `extractors`, and `hooks`.
- `validateConfig(value, cwd)` validates unknown input and returns a Result containing normalized config or a validation error.
- `loadWriteOnceConfig({ cwd, configPath? })` loads through c12, rejects ambiguous automatic discovery, and returns normalized config or an error.
- `NormalizedWriteOnceConfig` is the validated config shape used by the generation pipeline.

See [configuration](configuration.md) for defaults, file discovery, and supported formats.

## Extension contracts

The core exports independent `ResourcePreparer`, `ResourceResolver`, `ContentExtractor`, and `GenerationHook` contracts, plus their supporting types:

- A preparer synchronously selects source references in registration order; the first matching preparer wins. It then receives its selected references as one asynchronous-capable batch. Its context supplies a Write Once-managed temporary working directory; prepared resources must remain inside it. One result can describe multiple roots, each associated with the references it serves; provider-specific values remain opaque to the core. Write Once scans all destinations and assigns references before invoking each selected preparer once per generation. Its temporary working directory is removed after planning and writes finish. Resolvers receive the preparation batches associated with their reference. Triggers should be fast, synchronous, and side-effect-free.
- `ResourceResolver.resolve()` returns `ResolvedResource`: a root, relative path, and optional metadata, never file contents. The core normalizes and validates the location before loading it as `ResolvedContent`, which includes the resolved root/path and read-only source text. Extractors select content without mutating source text or performing I/O. A generation-scoped reader deduplicates source reads by normalized root + relative path, independent of selector/range. The pipeline counts extraction consumers, keeps content until the final consumer completes, and spills inactive cached text to a private temporary file when the configured content budget requires it. Provider-managed materialization/persistent caches remain the provider’s responsibility; the core clears its per-run content cache and spill files after planning. `ResourceContext` carries the full source-reference context and relevant preparation batches to resolvers.
- An extractor selects whole-file text, a named fragment, a range, or another content shape from an already resolved resource.
- A hook receives `HookContext` and returns either `{ text }` or `{ fullText }`.

A plugin can contribute any combination of preparers, resolvers, extractors, and hooks through `PluginContribution`. Resolvers, extractors, and hooks use registration order; the first compatible resolver or extractor is selected, and the first registered `pre-write` hook runs per generated block. Hooks are not chained.

The public contracts include marker spans, source coordinates, selectors, resource metadata, and structured diagnostics. Built-in resolver/extractor implementations and pipeline orchestration are not exported from the package root.

## Generation lifecycle

Each run follows the same staged order:

1. Discover and scan destination files, then collect all source references.
2. Select preparers in registration order and invoke each selected preparer once with its assigned references. All preparation completes before resolution starts.
3. Resolve every reference, normalize and validate each returned path, and group resources by normalized root + relative path. Selectors do not affect resource identity.
4. Load each unique source once. Bounded worker windows avoid launching work for every resource at once; inactive text spills to private temporary files when the content budget is reached.
5. Extract references and run the first registered matching pre-write hook in destination source order. This stage is sequential so hooks keep their existing observable ordering.
6. Build all destination plans, then stage safe writes. A planning or source-loading error prevents destination writes for that run.

The content budget considers retained string payload using UTF-16 bytes and observed process heap growth above the reader's starting baseline. Heap usage is process-wide and can include allocations unrelated to source text, so it is a practical pressure signal rather than an exact measurement of source-text memory. A single oversized source remains processable, and its content is removed after its final consumer completes.

## Current limits

- The built-in resolver handles local text files only.
- Built-in extractors support whole-file, named-fragment, and range selection.
- There is no project-wide named-fragment lookup, remote repository resolver, semantic TypeScript extraction, check command, or dry-run command in v1.

## Hook replacement boundaries

Given inline delimiter lines such as:

```md
before <!-- fragment source="./content.md" --> trailing
old content
suffix <!-- /fragment --> tail
```

A hook returning `{ text: content }` replaces only the body. The `before`, `trailing`, `suffix`, comment wrappers, and other delimiter-line text remain unchanged apart from the destination newline policy applied to inserted body text.

Returning `{ fullText: rebuiltBlock }` opts into replacing the wider span from the start of the opening delimiter line through the end of the closing delimiter line. That span includes inline wrappers and surrounding text on those lines. The hook must rebuild any marker syntax or wrappers it wants to keep.

Hooks use registration order. V1 runs only the first matching `pre-write` hook for each generated block; it does not chain hooks. A thrown or rejected hook is an error and prevents destination writes for that run.

The config loader and validator return Result values from `@opinionated-ts/result`; use its `isSuccess` and `isFailure` helpers to inspect them.
