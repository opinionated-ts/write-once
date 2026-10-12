# Phase 2 — Markers and built-in extraction

**Use this while implementing the parser, declaration index, and basic content selection.** Keep these parts independent from CLI/configuration and remote-source concerns.

## Implementation sequence

1. Define internal types for marker attributes, marker spans, parsed markers, selector descriptors, and diagnostics.
2. Implement a pure parser for marker opening lines and attribute syntax.
3. Scan text and pair opening/closing markers while recording exact offsets and line/column locations.
4. Reject malformed or ambiguous marker structures before writing anything.
5. Build a named-declaration index for the resolved source resource without modifying declaration bodies. In v1, the local resolver points to one source file; do not globally search destination files selected by `include`.
6. Implement the built-in whole-file selector.
7. Implement named-fragment extraction from declarations.
8. Implement line/column extraction after Phase 1 has defined indexing and range-end behavior.
9. Return extracted content and source-span metadata; do not write destination files from the extractor.

## Responsibilities

- Parser: syntax to structured data; no file writes.
- Marker scanner: finds marker pairs and source spans.
- Declaration index: maps names to declaration bodies within the resolved source resource and reports duplicates.
- Built-in extractors: select text from a resolved resource.
- Writer: remains a later stage and owns replacement behavior.

## Important edge cases

- Opening marker without a closing marker and closing marker without an opening marker.
- Duplicate attributes, empty attribute values, malformed quotes, unknown attributes.
- Duplicate declaration names and unresolved named references.
- Range with zero/negative positions, end before start, columns outside the line, and ranges beyond EOF.
- Empty source files, empty fragments, files with no final newline, and mixed newline conventions.
- Unicode characters: define whether columns count UTF-16 code units, Unicode code points, or another unit. Match the coordinate model of the language/tooling if semantic extractors may later use it.
- Markers inside code comments, Markdown, strings, or other syntax. V1 may use literal markers, but document that markers are recognized textually unless language-aware parsing is explicitly implemented.
- Multiple markers in one destination file and marker-like text inside a marker body.

## Constraints

- Do not use regular expressions alone if pairing, quoting, and precise spans require a small state machine or parser.
- Keep original text offsets so replacement can preserve all content outside the body.
- Do not rewrite a named declaration merely because it is also a source of reusable content.
- Do not silently trim extracted content or add/remove newlines without a documented rule.
- Keep parsing/extraction functions testable with in-memory strings and typed resources.

## Acceptance criteria

- [ ] Parser and extraction functions have focused unit tests.
- [ ] Every invalid input produces a useful diagnostic with a file and location when available.
- [ ] Named declarations can be indexed and read within the resolved source resource without modification.
- [ ] Whole-file, named-fragment, and range extraction follow the specification exactly.
- [ ] No destination writing occurs in this phase.
