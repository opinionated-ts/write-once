# Phase 6 — Testing and diagnostics

**Use this throughout development, and complete it before calling the implementation ready.** Tests should verify contracts and failure behavior, not only happy paths.

## Test layers

### Unit tests

- Attribute parsing and marker grammar.
- Marker pairing, spans, nesting/overlap validation, and source locations.
- Named declaration indexing and lookup.
- Whole-file, named-fragment, and line/column extraction.
- Path/range parsing and coordinate boundaries.
- Resolver selection, resource validation, extractor compatibility, and failure cases.
- Config normalization and validation.
- Hook return forms and replacement-span calculations.

### Integration tests

- Temporary project with a config, multiple source files, and multiple destination markers.
- Named declarations referenced from their resolved source file; verify that `include`/`exclude` does not change source lookup semantics.
- Include/exclude glob behavior.
- Generation updates only marker bodies and preserves other text.
- Multiple replacements in one file and multiple destination files.
- Re-running generation produces no content changes.
- CLI exit codes and diagnostics for invalid config and invalid markers.
- Simulated resolver, extractor, hook, and filesystem failures.

### Fixture matrix

Include fixtures for:

- LF and CRLF files.
- Empty files and empty fragments.
- Files with and without a final newline.
- Unicode content and columns near multi-unit characters.
- Quoted values, spaces, malformed attributes, duplicate attributes, and unknown attributes.
- Missing files, missing names, duplicate declarations, malformed ranges, and out-of-bounds positions.
- Unclosed markers, stray closing markers, nested markers, overlapping updates, and marker-like text in bodies.
- Read-only destinations and failed temporary-file rename/write operations where testable.

## Diagnostics requirements

Errors should identify:

- The destination file and marker location.
- The source reference when relevant.
- The stage that failed: parsing, resolution, extraction, hook, validation, or write.
- A concise actionable explanation.

Do not leak secrets from future resolver configuration or raw credentials in error output.

## Safety requirements

- Parse and validate all marker structures before writing.
- Resolve and validate source resources before writing.
- Do not partially rewrite a file when one of its markers fails.
- Test overlapping spans and offset handling explicitly.
- Ensure failure messages do not encourage silently ignoring broken markers.

## Repository validation

- Run `bun run test` during development and before completion.
- Run `bun run check` before declaring the phase complete.
- If `bun run fix` is needed, rerun `bun run check` and tests because formatting/lint fixes can alter files.
- Do not invoke TypeScript directly with a one-off `tsc --noEmit` command; use the repository's established scripts.

## Acceptance criteria

- [ ] Happy paths and meaningful failure paths are covered.
- [ ] Diagnostics identify the relevant file, marker, and pipeline stage.
- [ ] Failure tests prove destination contents remain unchanged.
- [ ] Test and repository checks pass.
