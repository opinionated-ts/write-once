# CLI workflow

The v1 command is:

```sh
write-once generate
```

Select a specific config file when automatic discovery would be ambiguous:

```sh
write-once generate --config ./write-once.config.ts
```

The short alias `-c` is also supported. Run `write-once --help`, `write-once generate --help`, or `write-once --version` for command help and version information.

## Processing

1. Load and validate the optional config.
2. Discover destination files using `include` and `exclude`.
3. Read and plan every destination in deterministic path order.
4. If any config, marker, resolution, extraction, or hook error occurs, stop before writing any destination.
5. Stage changed outputs in temporary sibling files, then atomically rename each file into place.

Unchanged files are not rewritten. The command is content-idempotent: after a successful run, running it again without source or destination changes does not rewrite the same outputs.

## Diagnostics and exit behavior

Diagnostics are written to stderr and include severity (`error`, `warning`, or `info`), processing stage, message, and available file/source location; `warning` is displayed as `warn`. Generation summaries go to stdout. Destination files are treated as UTF-8 text. Terminal colors are disabled when the environment or terminal does not support them, including `NO_COLOR`.

- Errors produce a non-zero exit code.
- Warnings alone do not fail the command. For example, no matching destination files is a warning.
- A failed plan prevents destination writes for that run.
- Writes are atomic per file, not across the project. If a later rename fails after earlier files were replaced, those earlier updates remain; write-once reports the partial result and does not claim rollback.

The v1 CLI does not provide `check` or dry-run modes. Remote resolvers and language-aware semantic extractors are also future work; the built-in resolver reads local text files only.

## Related guides

**Recommended next:**

- [Configuration](configuration.md)
- [Markers and selectors](markers.md)

**Other guides:**

- [Public TypeScript API](api.md)
- [JSON configuration](json-configuration.md)
- [YAML configuration](yaml-configuration.md)
- [README and quick start](../README.md)
