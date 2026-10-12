# YAML configuration

YAML is a secondary option for projects that only need static settings. It cannot define executable behavior or programmatically compose configuration. Use TypeScript when you need extends, custom resolvers, extractors, or hooks.

For editor validation, add a YAML language-server schema comment at the top of write-once.config.yaml:

```yaml
# yaml-language-server: $schema=https://unpkg.com/@opinionated-ts/write-once@0.1.0/write-once.schema.json
root: .
include:
  - "**/*.md"
exclude:
  - generated/**
respectGitignore: true
```

The JSON Schema is shared with JSON configuration because the supported static options have the same shape. Unknown additional properties are allowed for compatibility, but they do not add programmatic capabilities.

See [Configuration](configuration.md) for file discovery, defaults, and the recommended TypeScript API.
