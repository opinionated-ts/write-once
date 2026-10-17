# Plugin development

Write Once exposes TypeScript extension points for adapting source providers, selecting content, and customizing generated blocks. An extension can be a small object in a config file or a reusable module that exports a `PluginContribution`.

The project does not currently load, install, or discover third-party plugins automatically. Register their capabilities through `preparers`, `resolvers`, `extractors`, and `hooks` in an executable TypeScript or JavaScript config.

## How the pipeline uses extensions

1. **Prepare resources.** For each source reference, the first preparer whose `canPrepare(reference, context)` returns `true` is selected. Write Once groups references by that preparer and calls `prepare` once for its batch.
2. **Resolve the reference.** Resolvers are checked in registration order. Their `canResolve(source, context)` receives the reference's applicable context: if a preparer was selected, the context contains only that preparer's batch. A resolver can infer its association from the source and prepared context; no shared function identity, provider ID mapping, or separate registry is required. If no preparer claims the source, resolver-only handling remains possible with an empty `preparations` array. The first compatible resolver wins; if none matches, generation reports a resolution diagnostic.
3. **Load and extract content.** The core validates the resolver's root and relative path, loads source text, and selects the first compatible extractor. Configured extractors are checked before the built-in named-fragment, range, and whole-file extractors.
4. **Customize output.** The first registered `pre-write` hook runs for a generated block. Hooks are not chained. Without a matching hook, the extracted text is used as-is.
5. **Write destinations.** The pipeline plans and validates destination output before writing. A failure during preparation, resolution, extraction, or a hook prevents destination writes for that generation plan. Writes are atomic per file, not across the entire project.

Registration order is the conflict-resolution rule for matching capabilities. Keep each capability's `can*` method synchronous, deterministic, and narrow enough not to claim references it cannot handle.

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
- When `context.preparations` contains an assigned batch, the returned root must match one of that batch's declared resource roots after path normalization. The core rejects undeclared roots and paths that escape their root.
- Resolver metadata describes the resolved resource; it is separate from preparation metadata.

Use `context.preparations` to read the assigned batch's `references`, `result.resources`, resource metadata, or batch metadata. Do not search unrelated preparations or assume a resource has its own `references` list.

### `ContentExtractor`

An extractor receives a `ResolvedContent` with already-loaded, read-only `text`, the selector, and the resource context. `canExtract` chooses which selectors or resource types it handles. `extract` returns `{ text, location?, metadata? }` and should perform content transformation only: do not fetch resources, mutate source text, or write destination files. Throwing an error or returning a failure through the optional `extractResult` contract produces an extraction diagnostic.

Custom extractors run before the built-ins, so register a custom extractor before the defaults only when it deliberately handles that selector/resource combination. Language-aware symbol extraction is possible in a custom extractor that uses an appropriate parser, but Write Once does not provide semantic code analysis itself.

### `GenerationHook`

Hooks currently run at the `pre-write` stage. Return exactly one replacement scope:

- `{ text }` replaces only the generated body and preserves marker delimiters.
- `{ fullText }` replaces the complete marker block, including delimiters.

A hook should be deterministic and should not write destination files itself. Only the first matching `pre-write` hook runs, so combine transformations in one hook when they must run in sequence.

## Example provider plugin

This example demonstrates the contracts with a synthetic `example:` provider. It writes sample content into the temporary directory; it is not a built-in or remote provider integration.

Create `plugins/example.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { PluginContribution, PreparedResource } from "write-once";

export const examplePlugin: PluginContribution = {
  name: "example-provider",
  preparers: [
    {
      id: "example-provider",
      canPrepare: (reference) => reference.source.startsWith("example:"),
      async prepare(references, context) {
        const resources: PreparedResource[] = [];
        const sources = [...new Set(references.map((reference) => reference.source))];

        for (const source of sources) {
          const root = join(context.workingDirectory, String(resources.length));
          await mkdir(root, { recursive: true });
          await writeFile(
            join(root, "content.md"),
            `Example content for ${source}\n`,
            "utf8",
          );
          resources.push({
            root,
            metadata: { source, path: "content.md" },
          });
        }

        return {
          resources,
          metadata: { provider: "example", sourceCount: sources.length },
        };
      },
    },
  ],
  resolvers: [
    {
      id: "example-provider",
      canResolve(source, context) {
        const [preparation] = context.preparations ?? [];
        return (
          source.startsWith("example:") &&
          preparation?.references.some((reference) => reference.source === source) === true
        );
      },
      resolve(source, context) {
        const [preparation] = context.preparations ?? [];
        const resource = preparation?.result.resources.find(
          (candidate) => candidate.metadata?.source === source,
        );
        const path = resource?.metadata?.path;

        if (preparation === undefined || resource === undefined || typeof path !== "string") {
          throw new Error(`No prepared resource was returned for "${source}".`);
        }

        return {
          root: resource.root,
          path,
          metadata: { provider: preparation.result.metadata?.provider },
        };
      },
    },
  ],
};
```

Register its capabilities in `write-once.config.ts`:

```ts
import { defineConfig } from "write-once";

import { examplePlugin } from "./plugins/example.js";

export default defineConfig({
  include: ["**/*.md"],
  preparers: [...(examplePlugin.preparers ?? [])],
  resolvers: [...(examplePlugin.resolvers ?? [])],
  extractors: [...(examplePlugin.extractors ?? [])],
  hooks: [...(examplePlugin.hooks ?? [])],
});
```

A destination can now use a reference such as `example:intro`. The example resolver uses the source reference and the assigned preparation batch to find the matching resource; it does not compare function identities or use a manually configured preparer-to-resolver mapping.

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
  run({ content }) {
    return { text: `\`\`\`text\n${content}\n\`\`\`` };
  },
} satisfies GenerationHook;
```

Register the extractor and hook alongside the provider's capabilities. Remember that only one extractor and one `pre-write` hook are selected for each block; hooks do not form a pipeline. More advanced transformations, such as language-aware symbol or reference reuse, belong in custom extractors or a single hook that explicitly composes the required steps. These capabilities are extension opportunities, not built-in semantic analysis.

## Testing and operational guidance

- Unit-test capability predicates, metadata parsing, resource selection, and error paths independently.
- Add an integration test using a temporary project and `runGenerate` to verify the generated output, cleanup, and that invalid roots or missing resources leave destinations unchanged.
- Test registration-order conflicts explicitly when more than one extension could match.
- Keep provider-specific credentials outside source files and logs. Handle authentication failures, timeouts, retries, rate limits, and stale revisions in the provider adapter.
- Treat remote responses as untrusted input. Validate returned paths and metadata before using them, and only materialize resources under the provided `workingDirectory`.
- Use `bun run test`, `bun check`, and `bun run build` to validate changes.

## Current support and limitations

The built-in resolver supports local files. The example above is illustrative only; GitHub, Google Drive, OneDrive, remote repository access, and language-aware semantic extraction are not included integrations. Implement and register an adapter when a project needs one.

See the [TypeScript API](api.md) for exported contracts and the [configuration guide](configuration.md) for config formats and options.
