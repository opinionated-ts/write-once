# Implementation plan

This file is the workflow index for implementing `@opinionated-ts/write-once`. Follow the phases in order, use the linked GitHub issues to track work, and consult the phase document before changing scope or contracts.

## Workflow

| Phase | Focus                                                  | Guide                                                                                 | Issues                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | ------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Scope and invariants                                   | [00 — Scope and invariants](docs/implementation/00-scope-and-invariants.md)           | [#1](https://github.com/opinionated-ts/write-once/issues/1)                                                                                                                                                                                                                                                                                                                                                                                 |
| 1     | Finalize marker and source semantics                   | [01 — Specification](docs/implementation/01-specification.md)                         | [#1](https://github.com/opinionated-ts/write-once/issues/1)                                                                                                                                                                                                                                                                                                                                                                                 |
| 2     | Marker parsing, scanning, declarations, and extraction | [02 — Markers and extraction](docs/implementation/02-markers-and-extraction.md)       | [#2](https://github.com/opinionated-ts/write-once/issues/2), [#3](https://github.com/opinionated-ts/write-once/issues/3), [#4](https://github.com/opinionated-ts/write-once/issues/4), [#5](https://github.com/opinionated-ts/write-once/issues/5), [#8](https://github.com/opinionated-ts/write-once/issues/8), [#9](https://github.com/opinionated-ts/write-once/issues/9), [#10](https://github.com/opinionated-ts/write-once/issues/10) |
| 3     | Resolver and extractor contracts, local resolver       | [03 — Resolvers and extractors](docs/implementation/03-resolvers-and-extractors.md)   | [#6](https://github.com/opinionated-ts/write-once/issues/6), [#7](https://github.com/opinionated-ts/write-once/issues/7)                                                                                                                                                                                                                                                                                                                    |
| 4     | Config loading, file discovery, CLI                    | [04 — Configuration and CLI](docs/implementation/04-configuration-and-cli.md)         | [#11](https://github.com/opinionated-ts/write-once/issues/11), [#12](https://github.com/opinionated-ts/write-once/issues/12), [#13](https://github.com/opinionated-ts/write-once/issues/13), [#17](https://github.com/opinionated-ts/write-once/issues/17)                                                                                                                                                                                  |
| 5     | Generation pipeline, hook, safe writes                 | [05 — Hooks and safe writes](docs/implementation/05-hooks-and-safe-writes.md)         | [#14](https://github.com/opinionated-ts/write-once/issues/14), [#15](https://github.com/opinionated-ts/write-once/issues/15), [#16](https://github.com/opinionated-ts/write-once/issues/16)                                                                                                                                                                                                                                                 |
| 6     | Cross-cutting tests and diagnostics                    | [06 — Testing and diagnostics](docs/implementation/06-testing-and-diagnostics.md)     | [#18](https://github.com/opinionated-ts/write-once/issues/18)                                                                                                                                                                                                                                                                                                                                                                               |
| 7     | User documentation and release readiness               | [07 — Documentation and release](docs/implementation/07-documentation-and-release.md) | [#19](https://github.com/opinionated-ts/write-once/issues/19), [#20](https://github.com/opinionated-ts/write-once/issues/20)                                                                                                                                                                                                                                                                                                                |
| 8     | Optional post-v1 integrations                          | [08 — Future integrations](docs/implementation/08-future-integrations.md)             | [#21](https://github.com/opinionated-ts/write-once/issues/21)                                                                                                                                                                                                                                                                                                                                                                               |

The issues encode finer-grained dependencies. Check an issue's **Blocked by** section before starting it; a phase guide is not a substitute for issue-level prerequisites.

## Global invariants

- A declaration (`fragment name="x"` without `source`) is manually maintained and is never a generation destination.
- A destination with `source` selects a named fragment, range, or whole source file. Reject ambiguous selector combinations instead of guessing.
- V1 uses local project-relative sources only. Remote providers and semantic JS/TS extraction are future work.
- Resolvers obtain resources; extractors select content. Keep these contracts independent.
- By default, generation replaces only the marker body and preserves delimiters and unrelated text.
- Parse, resolve, extract, run hooks, and validate replacement spans before writing. Failures must not leave a destination partially updated.
- Keep behavior deterministic and diagnostics actionable. Do not add abstractions or options without a concrete v1 use case.

## Decisions that must be settled before implementation depends on them

- [ ] Marker grammar, whitespace, quoting/escaping, duplicate/unknown attributes, pairing, and nesting.
- [ ] Named-declaration duplicate/name-case rules and lookup scope.
- [ ] Range indexing, end-boundary semantics, Unicode column units, and out-of-bounds behavior.
- [ ] Source-path/range parsing, project/config root rules, and newline/final-newline preservation.
- [ ] Configuration precedence, include/exclude semantics, CLI root/config overrides, and exit behavior.
- [ ] Hook sync/async contract and the exact region represented by `{ fullText: string }`.
- [ ] Single-file atomicity and the transaction boundary when several destination files are generated.

Record decisions in [01 — Specification](docs/implementation/01-specification.md) or the phase document that owns the behavior. Do not leave incompatible interpretations spread across code, tests, and docs.

## Repository workflow

- Use Bun and the repository scripts in `package.json`.
- Run `bun run test` during implementation and before declaring a feature complete.
- Run `bun run check` before completion; if `bun run fix` changes files, rerun checks and tests.
- Run `bun run build` and test the built package before release.
- Do not bypass hooks or validation. Do not commit or push implementation changes unless explicitly requested.
