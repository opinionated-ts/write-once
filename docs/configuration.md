# Configuration

Configuration is optional. Without a config file, write-once uses the CLI working directory as its project `root`, includes `**/*`, and excludes Git metadata and dependency directories with `**/.git/**` and `**/node_modules/**`.

## File discovery

c12 supports these config extensions: `.js`, `.ts`, `.mjs`, `.cjs`, `.mts`, `.cts`, `.json`, `.jsonc`, `.json5`, `.yaml`, `.yml`, and `.toml`. Use a filename such as `write-once.config.ts` in the project root or `.config/` directory.

Automatic discovery fails if more than one supported `write-once.config.*` file is found. Select one explicitly with `write-once generate --config <path>`; config files are never silently merged. The path is resolved relative to the CLI working directory.

## TypeScript configuration

TypeScript is the recommended format because it supports the complete configuration API, including programmatic extensions (`resolvers`, `extractors`, and `hooks`).

Use `defineConfig` for editor autocomplete and type checking:

```ts
import { defineConfig } from "@opinionated-ts/write-once";

export default defineConfig({
  root: ".",
  include: ["**/*.md"],
  exclude: ["generated/**"],
  respectGitignore: true,
});
```

The helper is optional. Use `satisfies UserConfig` when you prefer a plain object:

```ts
import type { UserConfig } from "@opinionated-ts/write-once";

export default {
  root: ".",
  include: ["**/*.md"],
} satisfies UserConfig;
```

### Extending another config

Configuration files can extend a shared configuration. Paths are resolved by c12 relative to the config file:

```ts
import { defineConfig } from "@opinionated-ts/write-once";

export default defineConfig({
  extends: ["./config/write-once.base.ts"],
  include: ["content/**/*.md"],
});
```

Use executable TypeScript or JavaScript configs whenever you need programmatic behavior.

## Other formats

JSON and YAML are supported for static configuration, but cannot express executable behavior such as custom resolvers, extractors, hooks, or programmatic composition. They are documented separately as secondary options:

- [JSON configuration](json-configuration.md)
- [YAML configuration](yaml-configuration.md)

## Options

- `root` is resolved relative to the CLI working directory unless it is absolute. Source references are resolved from this effective root.
- `include` selects destination paths relative to `root`; `exclude` filters those matches afterward, so exclusions take precedence.
- Patterns use Git-ignore-style matching through `ignore`. Use positive patterns; leading `!` negation patterns are rejected to keep include/exclude precedence explicit.
- If `include` is omitted, the default is `**/*`.
- If `exclude` is omitted, `.git` and `node_modules` directories are excluded. Set `exclude: []` to disable those defaults.
- `respectGitignore` defaults to `true` and applies root and nested `.gitignore` rules during discovery. Set it to `false` to ignore `.gitignore` files; `include` and `exclude` still apply.
- `resolvers`, `extractors`, and `hooks` are programmatic extension points available in TypeScript or JavaScript config files.

## Security

TypeScript and JavaScript config files execute user code when loaded. Only load executable config files you trust.
