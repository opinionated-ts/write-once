# Plugin development

Write Once exposes TypeScript extension points for adapting source providers, selecting content, and customizing generated blocks. An extension can be a reusable module that exports a plugin factory returning a `PluginContribution`. Register the factory once through `plugins`; Write Once evaluates each factory once while validating the config and composes its optional capabilities.

The project does not currently load, install, or discover third-party plugins automatically. Register their capabilities through `preparers`, `resolvers`, `extractors`, and `hooks` in an executable TypeScript or JavaScript config.

## How the pipeline uses extensions

1. **Prepare resources.** For each source reference, the first preparer whose `canPrepare(reference, context)` returns `true` is selected. Write Once groups references by that preparer and calls `prepare` once for its batch.
2. **Resolve the reference.** Resolvers are checked in registration order. Their `canResolve(source, context)` receives the reference's applicable context: if a preparer was selected, the context contains only that preparer's batch. A resolver can match by source and, when useful, `context.preparation.preparerId`; the assigned batch is selected by the pipeline before resolver checks. If no preparer claims the source, resolver-only handling remains possible with no assigned `preparation`. The first compatible resolver wins; if none matches, generation reports a resolution diagnostic.
3. **Load and extract content.** The core validates the resolver's root and relative path, loads source text, and selects the first compatible extractor. Configured extractors are checked before the built-in named-fragment, range, and whole-file extractors. Only one extractor handles a reference. If the selected extractor fails, generation reports the extraction failure; Write Once does not silently try another extractor.
4. **Customize output.** Every registered `pre-write` hook runs for a generated block in registration order. Each hook receives the current `text` and `fullText` state produced by the previous hook. Without a matching hook, the extracted text is used as-is.
5. **Write destinations.** The pipeline plans and validates destination output before writing. A failure during preparation, resolution, extraction, or a hook prevents destination writes for that generation plan. Writes are atomic per file, not across the entire project.

Direct capability arrays are registered first, followed by plugin contributions in `plugins` array order. Within each capability, registration order is the conflict-resolution rule. Keep each capability's `can*` method synchronous, deterministic, and narrow enough not to claim references it cannot handle.

## Preparation contracts

### `ResourcePreparer`

- `canPrepare(reference, context)` synchronously identifies source references this preparer can prepare.
- `prepare(references, context)` may be asynchronous and receives all references assigned to that preparer for the run.
- `context.workingDirectory` is a Write Once-managed temporary directory for resources created during this run. Put prepared resources inside it; Write Once cleans it up after generation.
- Return `{ resources, metadata? }`. `metadata` belongs to the whole batch and must be a record-like object when supplied.

Each `PreparedResource` contains a `root` and optional resource-specific `metadata`. Reference assignments live on `PreparedResourceBatch.references`, not on individual resources. Use resource metadata to describe each root (for example, a provider path or source key) and batch metadata for state shared across the preparation (for example, a revision or provider response summary).

Every resource root must stay inside the preparer's working directory. If a preparer returns several roots, its resolver must return one of those declared roots for the source being resolved.

### `ResourceResolver`

- `canResolve(source, context)` synchronously identifies sources the resolver can resolve in the supplied context.
- `resolve(source, context)` returns `{ root, path, metadata? }`, where `path` is relative to `root`.
- Do not return source text from a resolver; the core validates and loads it.
- When `context.preparation` contains an assigned batch, the returned root must match one of that batch's declared resource roots after path normalization. The core rejects undeclared roots and paths that escape their root.
- Resolver metadata describes the resolved resource; it is separate from preparation metadata.

Use `context.preparation` to read the assigned batch's `preparerId`, `result.resources`, resource metadata, or batch metadata. Reference assignments are internal pipeline bookkeeping and are not exposed to resolvers.

### `ContentExtractor`

An extractor receives a `ResolvedContent` with already-loaded, read-only `text`, the selector, and the resource context. `canExtract` chooses which selectors or resource types it handles. `extract` returns `{ text, location?, metadata? }` and should perform content transformation only: do not fetch resources, mutate source text, or write destination files. Throwing an error or returning a failure through the optional `extractResult` contract produces an extraction diagnostic.

Custom extractors run before the built-ins, so registration order determines which compatible extractor wins. A later extractor is not a fallback when the selected extractor throws or returns a failure. Language-aware symbol extraction is possible in a custom extractor that uses an appropriate parser, but Write Once does not provide semantic code analysis itself.

### `GenerationHook`

Hooks currently run at the `pre-write` stage and are chained in registration order. Every hook receives both representations of the current block:

- `text` is the current generated body.
- `fullText` is the current complete block, including its delimiters.

A hook must return exactly one of `text` or `fullText`; returning both or neither is an error. Returning only `text` changes the body while inheriting the previous `fullText`. Returning only `fullText` replaces the complete block; Write Once derives the corresponding `text` from that new block before invoking the next hook.

When a hook returns a full block that cannot be structurally recognized as a generated marker block, Write Once derives its body from the content between the first and last lines so the next hook can still receive both representations. The hook is responsible for intentionally producing the replacement it wants.

A hook should be deterministic and should not write destination files itself. Hooks execute sequentially because each hook receives the state produced by the previous one.

## Example provider plugin

This example demonstrates the contracts with a synthetic `example:` provider. It prepares one shared directory tree for all assigned references; it is not a built-in or remote provider integration.

The source reference is the input to a deterministic mapping: `example:docs/guide.md` maps to `docs/guide.md` inside the prepared root. Both preparation and resolution use the same mapping function. Neither stage invents a file extension or changes the reference's path.

Create `plugins/example.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { PluginContribution } from "write-once";

function getResourcePath(source: string): string {
  const path = source.slice("example:".length);
  const segments = path.split("/");

  if (
    !path ||
    path.includes("\") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Invalid example source reference: "${source}".`);
  }

  return path;
}

export const examplePlugin = (): PluginContribution => ({
  name: "example-provider",
  preparers: [
    {
      id: "example-provider",
      canPrepare: (reference) => reference.source.startsWith("example:"),
      async prepare(references, context) {
        const root = context.workingDirectory;
        await mkdir(root, { recursive: true });

        // A real provider could clone a repository, fetch from cloud storage,
        // or otherwise materialize the resources requested by these references.
        // This example writes one placeholder file per reference using its exact path.
        for (const reference of references) {
          const path = getResourcePath(reference.source);
          await mkdir(dirname(join(root, path)), { recursive: true });
          await writeFile(
            join(root, path),
            `Example content for ${reference.source}\n`,
            "utf8",
          );
        }

        return {
          resources: [{ root }],
          metadata: { provider: "example", sourceCount: references.length },
        };
      },
    },
  ],
  resolvers: [
    {
      id: "example-provider",
      canResolve(source, context) {
        return (
          source.startsWith("example:") &&
          context.preparation?.preparerId === "example-provider"
        );
      },
      resolve(source, context) {
        const preparation = context.preparation;
        if (preparation === undefined) {
          throw new Error(`No preparation was assigned to "${source}".`);
        }

        return {
          root: preparation.result.resources[0]!.root,
          path: getResourcePath(source),
          metadata: { provider: preparation.result.metadata?.provider },
        };
      },
    },
  ],
});
```

Register the plugin once in `write-once.config.ts`:

```ts
import { defineConfig } from "write-once";

import { examplePlugin } from "./plugins/example.js";

export default defineConfig({
  include: ["**/*.md"],
  plugins: [examplePlugin],
});
```

A destination can now use references such as `example:intro.md` and `example:docs/setup.md`. The source carries the extension and relative path, so the consumer does not have to repeat `.md` in preparer or resolver code. The preparer creates one shared directory tree containing a file at each mapped path and returns that directory as a single `PreparedResource.root`. The resolver applies the same mapping to find the requested file; it does not create or require one root per file.

This is a deliberately simple materialization example. A remote provider can use the same deterministic mapping while cloning a repository, fetching objects from a cloud service, or preparing a filesystem-like view of remote content. The preparer returns only the roots and optional metadata needed for resolution; the original references remain pipeline bookkeeping.

## Composing extractors and hooks

A custom extractor can transform content after it has been loaded. For example, this extractor opts into resources marked with `format: "summary"` and uses the first line as the generated text:

```ts
import type { ContentExtractor } from "write-once";

export const summaryExtractor = {
  id: "summary-first-line",
  canExtract(resource, selector) {
    return selector.kind === "whole" && resource.metadata?.format === "summary";
  },
  extract(resource) {
    return { text: resource.text.split(/\r?\n/, 1)[0] ?? "" };
  },
} satisfies ContentExtractor;
```

A hook can then apply a destination-specific presentation change:

```ts
import type { GenerationHook } from "write-once";

export const textFenceHook = {
  id: "text-fence",
  stage: "pre-write",
  run({ text }) {
    return { text: `\`\`\`text\n${text}\n\`\`\`` };
  },
} satisfies GenerationHook;
```

Register the extractor and hook alongside the provider's capabilities. Only one extractor is selected for each block. Hooks form a separate transformation pipeline: every compatible `pre-write` hook runs in registration order. More advanced transformations, such as language-aware symbol or reference reuse, belong in custom extractors or hooks that explicitly implement those transformations. These capabilities are extension opportunities, not built-in semantic analysis.

## Testing and operational guidance

- Unit-test capability predicates, metadata parsing, resource selection, and error paths independently.
- Add an integration test using a temporary project and `runGenerate` to verify the generated output, cleanup, and that invalid roots or missing resources leave destinations unchanged.
- Test registration-order conflicts explicitly when more than one extension could match.
- Keep provider-specific credentials outside source files and logs. Handle authentication failures, timeouts, retries, rate limits, and stale revisions in the provider adapter.
- Treat remote responses as untrusted input. Validate returned paths and metadata before using them, and only materialize resources under the provided `workingDirectory`.
- Use `bun run test`, `bun check`, and `bun run build` to validate changes.

## Current support and limitations

The core's built-in resolver supports local files. The ecosystem also provides [write-once-github](https://github.com/opinionated-ts/write-once-github) for GitHub repository sources and [write-once-markdown](https://github.com/opinionated-ts/write-once-markdown) for fenced code output in Markdown. These are separately installed plugins, registered through the config file; they are not bundled into the core package. Other providers, such as Google Drive or OneDrive, require their own adapters. Language-aware semantic extraction is not built in, but can be implemented with a custom extractor.

See the [TypeScript API](api.md) for exported contracts and the [configuration guide](configuration.md) for config formats and options.
