# Phase 1 — Finalize the specification

**Use this before writing the parser or public API.** Resolve syntax and behavior questions here so implementation and tests share one contract.

## Marker model

A marker has an opening line, a body, and a closing `/fragment` line. The opening line contains attributes. Keep the grammar small and parse quoted attribute values predictably.

### Required forms

```text
fragment name="example"
Manually maintained content exposed for reuse.
/fragment

fragment source="./folder/files.ts" name="example"
Generated content.
/fragment

fragment source="./folder/files.ts:10:20-15:50"
Generated content.
/fragment

fragment source="./folder/files.ts"
Generated content.
/fragment
```

Semantics:

- `name` without `source`: named declaration. Its body is a source fragment and must not be rewritten by generation.
- `source` plus `name`: resolve the source, then extract the named declaration from it.
- `source` plus a range: resolve the source, then extract the selected range.
- `source` alone: extract the whole resolved source.
- `name` and range together: reject unless a later specification explicitly defines a useful meaning.
- Missing both `source` and `name`: reject as an invalid marker.

## Decisions required before implementation

- [ ] Decide whether marker delimiters must occupy an entire line and define accepted whitespace.
- [ ] Define attribute quoting, escaping, duplicate-attribute behavior, and unknown-attribute behavior.
- [ ] Define how markers are paired and whether nesting is prohibited. Prefer rejecting nesting in v1 unless a concrete use case requires it.
- [ ] Define behavior for duplicate named declarations and references to missing names.
- [ ] Define whether names are case-sensitive.
- [ ] Define line and column indexing. Prefer one-based human-facing coordinates; explicitly choose whether the range end is inclusive or exclusive.
- [ ] Define how a source path and range are parsed so Windows drive letters, colons in paths, and URL-like future sources are parsed correctly.
- [ ] Define newline preservation (`LF`/`CRLF`), final-newline behavior, and whether extracted ranges preserve their source line endings.
- [ ] Define path resolution relative to the config/project root, not the process's incidental current directory.
- [ ] Define declaration lookup scope. For v1, resolve `source + name` within the resolved source resource; for the local resolver this means the referenced source file. `include`/`exclude` selects destination files and must not silently widen named-fragment lookup to unrelated files.

Record decisions here before implementation. Do not add speculative syntax for future providers or semantic selectors; keep `source` and selection attributes conceptually separate.

## Suggested grammar constraints

- Require exactly one opening and closing marker per block.
- Reject malformed, unterminated, overlapping, or unsupported nested markers with file and line information.
- Treat text between markers as opaque content; do not parse it as a template language.
- Preserve source content as text. Do not normalize formatting unless the range specification explicitly requires it.
- Validate ranges before slicing and provide diagnostics for out-of-bounds coordinates.

## Acceptance criteria

- [ ] Every marker form above has a written, unambiguous interpretation.
- [ ] Invalid combinations fail with clear errors rather than silently choosing a selector.
- [ ] Path/range parsing has tests for colons, separators, and boundary positions.
- [ ] The parser contract can be implemented without knowing which resolver or extractor will eventually handle a source.
