# Public TypeScript API

The package root exports the config loader, config validator, and contracts intended for programmatic configuration and third-party extensions. Parsing, discovery, extraction, planning, and writing helpers are internal implementation details, not stable root exports.

## Configuration

- `WriteOnceConfig` describes optional `root`, `include`, `exclude`, `resolvers`, `extractors`, and `hooks`.
- `validateConfig(value, cwd)` validates unknown input and returns a Result containing normalized config or a validation error.
- `loadWriteOnceConfig({ cwd, configPath? })` loads through c12, rejects ambiguous automatic discovery, and returns normalized config or an error.
- `NormalizedWriteOnceConfig` is the validated config shape used by the generation pipeline.

See [configuration](configuration.md) for defaults, file discovery, and supported formats.

## Extension contracts

The core exports the independent `ResourceResolver`, `ContentExtractor`, and `GenerationHook` contracts, plus their supporting types:

- A resolver maps a source reference to a resource identity/location, text, and/or metadata.
- An extractor selects whole-file text, a named fragment, a range, or another content shape from an already resolved resource.
- A hook receives `HookContext` and returns either `{ text }` or `{ fullText }`.

A plugin can contribute any combination of resolvers, extractors, and hooks through `PluginContribution`. Resolver and extractor selection uses descending priority followed by registration order. The v1 pipeline runs one `pre-write` hook per generated block, selecting by priority and then registration order; hooks are not chained.

The public contracts include marker spans, source coordinates, selectors, resource metadata, and structured diagnostics. Built-in resolver/extractor implementations and pipeline orchestration are not exported from the package root.

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

Hooks are selected by descending `priority`, then registration order. V1 runs only the first matching `pre-write` hook for each generated block; it does not chain hooks. A thrown or rejected hook is an error and prevents destination writes for that run.

The config loader and validator return Result values from `@opinionated-ts/result`; use its `isSuccess` and `isFailure` helpers to inspect them.
