# Configuration

Configuration is optional. Without a config file, write-once uses the current working directory as its project root, includes `**/*`, and applies no exclusions.

Supported filenames include `write-once.config.ts`, `write-once.config.js`, `write-once.config.json`, `write-once.config.yaml`, and `write-once.config.yml`. c12 also supports its other documented config extensions.

Place a config file in the project root or in `.config/`. Automatic discovery fails if more than one supported `write-once.config.*` file is found. Select one explicitly with `--config <path>`.

```ts
export default {
  root: ".",
  include: ["**/*.md"],
  exclude: ["generated/**"],
};
```

- `root` is resolved relative to the CLI working directory unless it is absolute.
- `include` and `exclude` select destination files; exclusions take precedence.
- `resolvers`, `extractors`, and `hooks` accept programmatic extensions.
- Only one config file is loaded; config files are not silently merged.

**Security:** TypeScript and JavaScript config files execute user code when loaded. Only load executable config files you trust.
