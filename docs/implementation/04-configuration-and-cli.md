# Phase 4 — Configuration and CLI

**Use this after marker parsing and the basic resolver/extractor pipeline are usable as library functions.** Keep the CLI a thin orchestration layer.

## Configuration files

Support discovery of the first matching supported config file:

- `write-one.config.ts`
- `write-one.config.js`
- `write-one.config.json`
- `write-one.config.yaml`

Before implementation, define config precedence if more than one file exists. Prefer reporting ambiguity or a documented deterministic precedence rather than silently merging unrelated configs.

## Configuration fields

- `include`: glob patterns for destination files to scan for markers.
- `exclude`: glob patterns for destination files to skip. These patterns do not redefine which content a referenced source file exposes to its extractor.
- `resolvers`: registered resolver implementations and their options.
- `extractors`: registered extractor implementations and their options.
- Optional pre-write hook configuration, if hooks are configured rather than exported directly from the config module.

Keep defaults predictable. Avoid introducing a large option surface; options should correspond to a real behavior or plugin requirement.

## Implementation sequence

1. Define the public configuration type and runtime validation.
2. Implement config discovery from a clearly defined project root.
3. Implement loaders for supported formats, including the execution/security implications of TS/JS config files.
4. Normalize configuration into one internal representation.
5. Resolve relative paths consistently against the project/config root.
6. Implement include/exclude discovery and deterministic ordering.
7. Register configured resolvers and extractors, then validate that required handlers exist.
8. Implement `write-one generate` as the primary command.
9. Add useful CLI output, exit codes, and error summaries.
10. Add help and version output if supported by the existing package setup.

## CLI behavior to define

- [ ] Working directory/project root selection and any explicit CLI override.
- [ ] Whether a config path can be supplied explicitly.
- [ ] Behavior when no config file exists or multiple config files exist.
- [ ] Whether generation supports dry-run/check mode; defer if not required for safe v1.
- [ ] Whether unchanged files are left untouched, including modification times.
- [ ] Exit codes for invalid config, invalid markers, resolution/extraction failure, and write failure.
- [ ] Output verbosity and whether diagnostics are written to stderr.
- [ ] Whether generated files are processed sequentially or concurrently. Start sequentially unless profiling justifies concurrency.

## Security and reliability

- Executing TS/JS config files executes user code; document this clearly.
- Do not fetch remote content in v1.
- Normalize and validate paths; avoid accidental writes outside the project through incorrectly interpreted destination paths. Source paths and destination-discovery patterns have separate roles and must not be conflated.
- Do not write output until marker parsing, resolution, extraction, and validation for the intended update have succeeded.

## Acceptance criteria

- [ ] Config formats load into the same validated internal type.
- [ ] Include/exclude behavior is deterministic and tested.
- [ ] CLI invokes the pipeline and reports actionable errors.
- [ ] Project-relative path behavior does not depend on incidental process state.
