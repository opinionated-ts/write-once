# YAML configuration

YAML is a secondary option for projects that only need static settings. It cannot define executable behavior or programmatically compose configuration. Use TypeScript when you need extends, custom resolvers, extractors, or hooks.

For editor validation, add a YAML language-server schema comment at the top of write-once.config.yaml:

```yaml
# yaml-language-server: $schema=https://unpkg.com/write-once/write-once.schema.json
root: .
include:
  - "**/*.md"
exclude:
  - generated/**
respectGitignore: true
```

The JSON Schema is shared with JSON configuration because the supported static options have the same shape. Unknown additional properties are allowed for compatibility, but they do not add programmatic capabilities. The schema version is tracked independently from package releases and changes only when this contract changes.

See [Configuration](configuration.md) for file discovery, defaults, and the recommended TypeScript API.

## Related guides

**Recommended next:**

- [Configuration](configuration.md)
- [JSON configuration](json-configuration.md)

**Other guides:**

- [Public TypeScript API](api.md)
- [CLI workflow and diagnostics](cli.md)
- [Markers and selectors](markers.md)
- [README and quick start](../README.md)
