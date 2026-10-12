# Phase 7 — Documentation and release readiness

**Use this after core behavior and CLI usage are stable.** Document what exists today; label future directions as future work and do not imply unsupported integrations are available.

## Documentation deliverables

- [ ] Keep the root README short: what `write-once` does, a minimal example, installation/usage entry point, and links to deeper documentation.
- [ ] Document supported config filenames, config fields, defaults, and path-resolution rules.
- [ ] Document marker syntax for named declarations, named references, ranges, and whole-file references.
- [ ] Document line/column indexing, range end semantics, newline behavior, and named-declaration lookup scope.
- [ ] Document the CLI command, expected output, exit codes, and common failure cases.
- [ ] Document resolver/extractor contracts only to the level actually implemented and stable enough for users.
- [ ] Explain that TS/JS config files execute code if those formats are supported.
- [ ] Provide examples that demonstrate preserved surrounding text and manually maintained named declarations.
- [ ] Clearly distinguish supported behavior from future integrations such as GitHub, npm, and semantic symbol extraction.

## API and package review

- [ ] Confirm public types have clear names and narrow responsibilities.
- [ ] Avoid exposing implementation details that should remain internal.
- [ ] Check package exports, build output, package metadata, and installation behavior.
- [ ] Confirm the README does not promise unsupported source types or selectors.
- [ ] Confirm errors and hook behavior are documented consistently with tests.

## Final verification

- [ ] Run `bun run test`.
- [ ] Run `bun run check`.
- [ ] Run `bun run build`.
- [ ] Test the built CLI/package in a clean temporary project rather than relying only on source aliases.
- [ ] Review `git diff` for accidental files, generated output, or unrelated template leftovers.
- [ ] Confirm the first-version scope remains focused.

## Release decision

Only call the first version ready when the core acceptance criteria, preservation guarantees, CLI behavior, docs, and checks all pass. Do not add a remote provider merely to make the architecture look complete.
