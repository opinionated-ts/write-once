# Phase 3 — Resolver and extractor contracts

**Use this when defining extension points and connecting source selection to extraction.** The interfaces must be independent, composable, and small enough for third-party plugins to implement.

## Responsibilities

### Resolver

A resolver identifies and prepares a source. It receives the source reference and relevant options, then returns a typed resource with enough context for extraction.

A resource may represent:

- One local file path.
- Multiple file paths.
- A project root and associated configuration.
- A resource kind and typed metadata required by a particular extractor.
- Prepared resources with a defined lifetime or cleanup operation, if a future provider needs it.

Do not require every resolver to return a single absolute path. That would make project-aware analysis, such as TypeScript symbol resolution, unnecessarily difficult.

### Extractor

An extractor interprets a resolved resource and a selector descriptor, then returns extracted text and useful source metadata. It must not own remote downloading or destination writes.

Possible future extractors include text, JSON, JavaScript, and TypeScript. A TypeScript extractor may require a project root, multiple files, `tsconfig.json`, and compiler context to resolve a symbol such as `UserService.create`.

## Composition model

Keep the interfaces independent even if a single package exports both:

- Local resolver + built-in text extractor.
- Local resolver + TypeScript extractor.
- Future GitHub resolver + TypeScript extractor.
- Future npm resolver + JSON extractor.
- A package that exports both a resolver and a compatible extractor.

The core orchestrates resolution, extractor selection, extraction, and lifecycle cleanup. Neither resolver nor extractor should need to implement unrelated responsibilities. For v1, the local resolver returns one source file; richer multi-file resources are an extension point, not a requirement to implement project-wide semantic resolution.

## Contract requirements

- [ ] Define typed `Resolver` and `Extractor` interfaces separately.
- [ ] Define a typed `ResolvedResource` union or equivalent extensible resource contract. Avoid an untyped catch-all as the primary API.
- [ ] Define a typed selector model for whole-file, named-fragment, and range requests; leave room for future format-specific selectors without inventing their syntax now.
- [ ] Let resolvers declare which source references they support.
- [ ] Let extractors declare compatible resource kinds and, when useful, file extensions or languages.
- [ ] Treat extensions as a compatibility hint, not the sole selection mechanism.
- [ ] Define deterministic resolver/extractor selection and behavior when none or multiple candidates match.
- [ ] Define how resolver/extractor options are configured and validated.
- [ ] Define resource ownership and cleanup semantics before adding temporary directories or caches.
- [ ] Keep plugin errors distinguishable from malformed marker, missing source, and extraction errors.
- [ ] Define what context is available to diagnostics and the pre-write hook.

## Initial implementation boundary

Implement one local resolver and built-in extractors only. The architecture should support later plugins, but v1 does not need remote providers, semantic language analysis, automatic discovery, a capability registry, or plugin dependency management.

## Avoid

- A resolver that downloads a source and also parses every possible file format.
- An extractor that assumes all inputs are single local files.
- Forcing provider identity into the selection syntax in ways that collide with paths or selectors.
- Exposing internal cache paths as the only meaningful source identity.
- Adding a generic plugin framework before a second real resolver or extractor proves which abstractions are necessary.

## Acceptance criteria

- [ ] A local source can pass through the same resolver/extractor pipeline intended for future plugins.
- [ ] A resolver can return richer context without changing the core orchestration contract.
- [ ] A package can implement a resolver, an extractor, or both.
- [ ] Unit tests cover unsupported resources and resolver/extractor selection failures.
