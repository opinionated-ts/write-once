# TypeScript API

The TypeScript API is for projects that need to customize how write-once prepares resources, resolves source references, extracts content, or handles generated blocks. Most projects can use the CLI and a configuration file without writing extensions.

## Configuration helpers

- `defineConfig(config)` provides typed configuration with editor autocomplete.
- `validateConfig(value, cwd)` validates unknown configuration and returns a Result.
- `loadWriteOnceConfig({ cwd, configPath? })` loads and normalizes a configuration file, returning a Result.
- `WriteOnceConfig` and `UserConfig` describe the supported configuration options.

See the [configuration guide](configuration.md) for defaults and examples, or the [plugin development guide](plugins.md) for end-to-end extension examples.

## Extension points

Extensions are registered through the `preparers`, `resolvers`, `extractors`, and `hooks` configuration options. A plugin can provide any combination of these through `PluginContribution`.

- **Preparers** select source references that need provider-specific setup and prepare resources before resolution. Their context provides a per-run `workingDirectory` that core cleanup removes and a stable `workspaceDirectory` that plugins manage across runs.
- **Resolvers** map the original source reference to a resource root and relative path. The source should carry its own path/format information; preparers and resolvers must use the same deterministic mapping instead of independently appending extensions. They return locations, not file contents.
- **Extractors** select the content to reuse from a resolved resource, such as a whole file, named fragment, or range.
- **Hooks** customize generated content before it is written. All `pre-write` hooks run in registration order, each receiving the current `text` and `fullText`. A hook must return exactly one representation; Write Once derives `text` when a hook replaces only `fullText`.

Registration order matters: the first matching preparer, resolver, or extractor is selected. Hooks are the exception: every `pre-write` hook runs sequentially.

Use the exported contracts such as `ResourcePreparer`, `ResourceResolver`, `ContentExtractor`, `GenerationHook`, and `PluginContribution` to implement extensions. The built-in pipeline helpers are internal and are not exported from the package root. See the [plugin development guide](plugins.md) for capability matching, preparation scoping, metadata, and a complete example.

## Current limitations

- The built-in resolver supports local text files; install and register a provider plugin such as [write-once-github](https://github.com/opinionated-ts/write-once-github) to resolve GitHub repository files.
- Named fragments are looked up only within the source resource selected by `source`, not across the whole project.
- Language-aware semantic extraction is not built in. A custom extractor can implement symbol- or AST-based selection.
- The CLI does not yet provide `check` or dry-run modes.

For the everyday workflow, see the [CLI guide](cli.md). For marker syntax, see [Markers and selectors](markers.md).
