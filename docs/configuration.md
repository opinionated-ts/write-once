# Configuration

Configuration is optional. Without a config file, write-once uses the CLI working directory as its project root, includes `**/*`, and excludes Git metadata and dependency directories with `**/.git/**` and `**/node_modules/**`.

## File discovery

c12 supports these config extensions: `.js`, `.ts`, `.mjs`, `.cjs`, `.mts`, `.cts`, `.json`, `.jsonc`, `.json5`, `.yaml`, `.yml`, and `.toml`. Use a filename such as `write-once.config.ts` in the project root or `.config/` directory.

Automatic discovery fails if more than one supported `write-once.config.*` file is found. Select one explicitly with `write-once generate --config <path>`; config files are never silently merged. The path is resolved relative to the CLI working directory.

## Options

```ts
export default {
  root: ".",
  include: ["**/*.md"],
  exclude: ["generated/**"],
};
```

- `root` is resolved relative to the CLI working directory unless it is absolute. Source references are resolved from this effective root.
- `include` selects destination paths relative to `root`; `exclude` filters those matches afterward, so exclusions take precedence.
- Patterns use Git-ignore-style matching through `ignore`. Use positive patterns; leading `!` negation patterns are rejected to keep include/exclude precedence explicit.
- If `include` is omitted, the default is `**/*`.
- If `exclude` is omitted, `.git` and `node_modules` directories are excluded. Set `exclude: []` to disable those defaults.
- `resolvers`, `extractors`, and `hooks` are programmatic extension points. Function-valued extensions require an executable config such as TypeScript or JavaScript; JSON/YAML/TOML cannot contain functions.

## Security

TypeScript and JavaScript config files execute user code when loaded. Only load executable config files you trust.
