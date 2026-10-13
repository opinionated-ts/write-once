# @opinionated-ts/write-once

Keep reusable content in one source file and update marked sections in destination files. write-once uses language-agnostic text markers; it does not parse the host language.

## Quick start

Add a config to limit discovery to Markdown files:

```ts
// write-once.config.ts
export default {
  include: ["**/*.md"],
  respectGitignore: true,
};
```

In `content.md`, mark a source section:

<!-- write-once-ignore-start -->

```md
<!-- fragment name="intro" -->
Reusable introduction.
<!-- /fragment -->
```

<!-- write-once-ignore-end -->

In `README.md`, reference it from a destination:

<!-- write-once-ignore-start -->

```md
<!-- fragment source="./content.md" name="intro" -->
Generated introduction.
<!-- /fragment -->
```

<!-- write-once-ignore-end -->

Run:

```sh
bunx @opinionated-ts/write-once generate
```

By default, only the text between the marker lines is replaced. Unchanged files are not rewritten; writes are atomic per file, not across the whole project.

## Guides

- [Marker syntax and selectors](docs/markers.md)
- [Configuration](docs/configuration.md)
- [CLI workflow and diagnostics](docs/cli.md)
- [Public TypeScript API](docs/api.md)
