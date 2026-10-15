# JSON configuration

JSON is a secondary option for projects that only need static settings. It cannot define executable behavior or programmatically compose configuration. Use TypeScript when you need extends, custom resolvers, extractors, or hooks.

Add the published JSON Schema reference to enable editor validation and autocomplete:

```json
{
  "$schema": "https://unpkg.com/write-once/write-once.schema.json",
  "root": ".",
  "include": ["**/*.md"],
  "exclude": ["generated/**"],
  "respectGitignore": true
}
```

The schema describes the JSON-serializable options: root, include, exclude, and respectGitignore. Unknown additional properties are allowed for compatibility, but they do not add programmatic capabilities. The schema version is tracked independently from package releases and changes only when this contract changes.

See [Configuration](configuration.md) for file discovery, defaults, and the recommended TypeScript API.

## Related guides

**Recommended next:**

- [Configuration](configuration.md)
- [YAML configuration](yaml-configuration.md)

**Other guides:**

- [Public TypeScript API](api.md)
- [CLI workflow and diagnostics](cli.md)
- [Markers and selectors](markers.md)
- [README and quick start](../README.md)
