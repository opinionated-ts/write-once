# Future work — External resolvers and semantic extractors

**Do not use this as a v1 implementation checklist.** Revisit only when the local-source workflow is stable and a concrete use case justifies the added dependencies and complexity.

## Remote source resolvers

Potential future resolvers:

- GitHub/repository references.
- npm package references.
- Other hosted or versioned source stores.

A remote resolver may download or materialize files into a cache or temporary directory, but it must return a resource contract that compatible extractors can use. Define cache invalidation, version/commit pinning, authentication, offline behavior, cleanup, and trust boundaries before implementation.

Illustrative syntax only; not finalized:

```text
fragment source="@repo:owner/repo/path/file.ts" name="example"
content to be generated
/fragment

fragment source="@npm:package-name/path/file.json" name="example"
content to be generated
/fragment
```

Keep source identification separate from the selection expression. Avoid relying on path suffixes for every future selector, since they can conflict with paths, URLs, or language-specific syntax.

## Semantic extractors

Potential future extractors:

- JSON property or structured-data selectors.
- JavaScript/TypeScript declarations, symbols, and references.
- Other language-specific or structured-document selectors.

A TypeScript extractor may need the project root, multiple files, `tsconfig.json`, and compiler context. It should resolve symbols using language tooling rather than brittle text matching. Consider whether it can work with a resource prepared by a remote resolver and what happens when the remote source lacks its original project context.

## Questions to answer before building an integration

- What concrete user workflow does this integration unlock?
- Does the existing resolver/extractor contract support it without provider-specific branching in core?
- What resource data and metadata are essential, and which are plugin-private?
- How are versions pinned so generated output is reproducible?
- How are credentials kept out of logs, errors, caches, and generated files?
- What are the network, trust, cache, and cleanup implications?
- What tests can run deterministically without depending on live services?
- Is the feature worth its maintenance and dependency cost?

## Guardrails

- Keep provider-specific authentication, network access, download, cache, and cleanup in the resolver.
- Keep format-specific parsing and selection in the extractor.
- Permit a plugin package to provide a resolver, an extractor, or both.
- Do not add complex discovery, capability negotiation, or plugin dependency management without demonstrated need.
- Prefer deterministic pinned references over floating branches or versions where reproducibility matters.
