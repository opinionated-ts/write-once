# Phase 5 — Hooks and safe writes

**Use this when extraction is stable and the full generation pipeline is ready to update destination files.** File replacement must preserve content outside the intended region and avoid partial writes.

## Pre-write hook

The hook runs after source resolution and extraction but before the destination file is written. It may transform the extracted result or request a wider replacement.

Context should include, where applicable:

- Destination file path and marker span.
- Original source reference and resolved resource.
- Selected content descriptor (whole file, named fragment, range, or future selector).
- Extracted text and relevant source metadata.
- The original destination text and surrounding marker context needed for a safe decision.
- Resource kind, extension, or plugin metadata when available; do not assume every source is one file.

Define two explicit return forms:

- `{ text: string }`: replace only the body between marker delimiters.
- `{ fullText: string }`: replace a separately defined wider region.

Before implementing `fullText`, define its exact target boundaries and prove them with tests. It must not ambiguously mean both the whole file and the marker region.

## Hook constraints

- [ ] Define the typed hook signature and return type.
- [ ] Define whether the hook is synchronous or asynchronous; prefer async-compatible execution if source plugins are async.
- [ ] Document whether the hook should not throw and how thrown errors are surfaced. Do not silently swallow errors.
- [ ] Decide whether multiple hooks are supported. Avoid hook chaining unless there is a concrete use case.
- [ ] Ensure hook output cannot accidentally bypass destination-span validation.
- [ ] Ensure a hook failure prevents the affected write.

## Safe update strategy

1. Read and retain the original destination text.
2. Parse all markers and compute exact body spans.
3. Resolve and extract all requested content before writing the file.
4. Run hooks and validate every proposed replacement.
5. Build the final file in memory using original offsets; apply replacements in descending offset order or use an equivalent span-safe strategy.
6. If any operation fails, leave the original file untouched.
7. Write to a temporary sibling file and atomically rename where supported; handle cleanup on failure.
8. Avoid rewriting files whose contents have not changed.

If several files are being generated, decide and document the transaction boundary before implementation. V1 must guarantee that one destination file is not partially updated; stage all destination outputs before writes when practical, and explicitly document whether a failure in a later file can leave earlier files updated.

## Preservation requirements

- Preserve opening and closing marker lines by default.
- Preserve unrelated text byte-for-byte where practical.
- Preserve newline style and final-newline behavior according to the specification.
- Do not trim generated content without an explicit rule.
- Detect overlapping replacement spans and reject them before writing.

## Acceptance criteria

- [ ] Default updates replace only marker bodies.
- [ ] Hook failures, extraction failures, and invalid spans leave destination files unchanged.
- [ ] Multiple replacements in one file do not invalidate each other's offsets.
- [ ] Unchanged output does not rewrite the destination unnecessarily.
- [ ] Tests prove preservation of surrounding text and marker delimiters.
