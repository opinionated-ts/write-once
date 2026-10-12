# JSON configuration

JSON is a secondary option for projects that only need static settings. It cannot define executable behavior or programmatically compose configuration. Use TypeScript when you need extends, custom resolvers, extractors, or hooks.

Add the published JSON Schema reference to enable editor validation and autocomplete:

```json
{
  "$schema": "https://unpkg.com/@opinionated-ts/write-once@0.1.0/write-once.schema.json",
  "root": ".",
  "include": ["**/*.md"],
  "exclude": ["generated/**"],
  "respectGitignore": true
}
```

The schema describes the JSON-serializable options: root, include, exclude, and respectGitignore. Unknown additional properties are allowed for compatibility, but they do not add programmatic capabilities.

See [Configuration](configuration.md) for file discovery, defaults, and the recommended TypeScript API.
