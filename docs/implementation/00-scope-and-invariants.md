# Phase 0 — Scope and invariants

**Use this document before implementation begins or when scope starts to drift.** Establish what the first version must do, what it must not do, and which constraints every later phase must preserve.

## Product goal

`write-once` is a marker-based content reuse tool. A user maintains a source of truth and places markers in destination files. Generation resolves a source, extracts the requested content, and updates only the content region of the destination marker by default.

This is a focused fragment copier, not a general-purpose template engine, build system, or language server.

## First-version scope

- Scan project files selected by `include` and `exclude` glob patterns.
- Parse `fragment` opening markers and `/fragment` closing markers.
- Support manually maintained named declarations, local named references, local line/column ranges, and whole-file references.
- Resolve local project-relative paths.
- Use built-in extractors for whole-file content, named fragments, and line/column ranges.
- Provide a CLI command such as `write-one generate`.
- Load supported config formats: `write-one.config.ts`, `.js`, `.json`, and `.yaml`.
- Allow an optional pre-write hook.
- Report malformed markers, missing files, invalid selectors, ambiguity, and write failures clearly.

## Explicitly not required for v1

- GitHub/repository or npm source providers.
- Semantic JavaScript/TypeScript symbol resolution.
- Authentication, network access, downloading, remote caching, or provider-specific cleanup.
- A complex plugin marketplace, auto-discovery mechanism, capability negotiation system, or dependency graph between plugins.
- Rewriting text outside marker content unless an explicit hook result requests a wider, precisely defined region.

## Invariants

1. **Preserve by default.** Opening and closing marker lines and all unrelated destination text remain unchanged.
2. **Declarations are not destinations.** `fragment name="x"` without `source` exposes manually maintained content; generation must not rewrite it.
3. **Explicit selectors.** `source`, `name`, and range selection have clear meanings. Reject ambiguous combinations instead of guessing.
4. **Separate resolution from extraction.** Resolvers obtain a resource; extractors interpret it and select content. One package may provide both, but either interface must remain independently usable.
5. **Do not assume one file.** A resolved resource may need multiple files, a project root, configuration, or typed metadata.
6. **Keep the core small.** Provider-specific operations belong in resolvers; format-specific interpretation belongs in extractors.
7. **No unnecessary abstraction.** Design the extension points, but implement only the local resolver and basic extractors in v1.
8. **Deterministic behavior.** The same inputs and configuration should produce the same output, absent an explicitly nondeterministic external hook.
9. **Fail safely.** Invalid input or an extraction failure must not partially overwrite destination files.

## Repository constraints

- Use Bun-first commands and the scripts already defined in `package.json`.
- Run `bun run check` for repository checks and `bun run test` for tests; use `bun run fix` only when intentionally applying automated fixes, then re-run checks.
- Do not bypass hooks or validation.
- Do not commit or push implementation work unless explicitly requested.

## Exit criteria

- [ ] v1 scope and exclusions are understood.
- [ ] The invariants above are reflected in design and tests.
- [ ] No future feature is silently treated as a v1 requirement.
