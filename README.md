# write-once

[![npm version](https://img.shields.io/npm/v/write-once)](https://www.npmjs.com/package/write-once)
[![npm downloads](https://img.shields.io/npm/dm/write-once)](https://www.npmjs.com/package/write-once)
[![CI](https://img.shields.io/github/actions/workflow/status/opinionated-ts/write-once/check-and-release.yml?label=CI)](https://github.com/opinionated-ts/write-once/actions/workflows/check-and-release.yml)
[![License](https://img.shields.io/github/license/opinionated-ts/write-once)](https://github.com/opinionated-ts/write-once/blob/main/LICENSE)

**Write it once. Keep it consistent everywhere.**

Reuse documentation, AI-agent instructions, skills, and any other text without maintaining duplicate copies. Define content in one place, reference it wherever you need it, and let write-once keep those sections in sync.

> ❤️ If you find this project useful, consider giving the repo a star — it helps support the project.

## Why

Reusable content tends to get copied: a project description appears in several documents, the same guidance is repeated across agent instructions, or multiple skills slowly drift apart. Imports can help in some formats, but they are not universal and may add unwanted dependencies between documents.

**write-once gives reusable text a single source of truth.** It works with plain text markers, so your content can live in Markdown, code comments, instructions, or other text files without write-once needing to understand the language around it.

- **Write once, reuse anywhere in your project** — reference one source from multiple destination files.
- **Keep content in sync** — regenerate destinations when the source changes instead of updating every copy by hand.
- **Reuse AI instructions and skills** — share agent guidance without maintaining near-identical versions.
- **Avoid format-specific imports** — use the same simple marker syntax across different kinds of text files.
- **Keep your files yours** — only the content inside a generated fragment is replaced; surrounding text stays in place.

## Quick start

Create a source file such as `content.md` and give the reusable section a name:

<!-- write-once-ignore-start -->

```md
<!-- fragment name="intro" -->
A short introduction maintained in one place.
<!-- /fragment -->
```

<!-- write-once-ignore-end -->

Reference that fragment wherever you want the content to appear. For example, in `README.md`:

<!-- write-once-ignore-start -->

```md
<!-- fragment source="./content.md" name="intro" -->
This text will be replaced with the source fragment.
<!-- /fragment -->
```

<!-- write-once-ignore-end -->

Then run:

```sh
bunx write-once generate
# npx write-once generate
```

The destination now contains the source text. Run the command again whenever you want to synchronize your files. Unchanged files are not rewritten.

## How it works

write-once uses plain-text markers to identify source fragments and generated destinations. It does not parse Markdown or the host language, so the same approach can be used for documentation, agent instructions, skills, code examples, and other reusable text.

Only generated sections are replaced; the rest of each destination remains yours. Plugins extend write-once when you need to reuse content from other sources or tailor generated output.

## Example

Combine the GitHub and Markdown plugins to publish a code example from another repository without copying it by hand.

```sh
bun add -d write-once write-once-github write-once-markdown
```

Register both plugins in `write-once.config.ts`:

```ts
import { defineConfig } from "write-once";
import { githubPlugin } from "write-once-github";
import { markdownPlugin } from "write-once-markdown";

export default defineConfig({ plugins: [githubPlugin, markdownPlugin] });
```

Then reference the source file in your README:

<!-- write-once-ignore-start -->

<!-- prettier-ignore -->
````md
<!-- fragment source="repo:opinionated-ts/write-once@main/src/index.ts" -->
Your synchronized code example appears here.
<!-- /fragment -->
````

<!-- write-once-ignore-end -->

Run `bunx write-once generate` to refresh the example. The GitHub plugin retrieves the source; the Markdown plugin formats it as a code fence. See the plugin guides for configuration details and other supported options.

## Guides

- [Markers and selectors](docs/markers.md) — define reusable fragments, reference sources, select ranges, and suppress intentional examples.
- [Configuration](docs/configuration.md) — choose which files write-once processes and tune its behavior.
- [CLI workflow](docs/cli.md) — run generation and understand diagnostics and failure behavior.

For advanced customization, see the [TypeScript API](docs/api.md) and the [plugin development guide](docs/plugins.md).

## Plugins

- [write-once-github](https://github.com/opinionated-ts/write-once-github) — resolve files from GitHub repositories using local Git checkouts.
- [write-once-markdown](https://github.com/opinionated-ts/write-once-markdown) — format extracted source code as fenced code blocks in Markdown destinations.

Plugins are registered through the config file and can contribute source preparation, resolution, extraction, or output hooks. See the [plugin development guide](docs/plugins.md) to build your own.

## Open Source for the Community

`write-once` is part of the [Opinionated TS](https://github.com/opinionated-ts) ecosystem, a collection of independent projects created to improve the TypeScript and JavaScript development experience. Every project is **open source**, **free to use**, and **open to community contributions**.

**Contributions are more than welcome — they're the whole point.**

- 💬 **Found a bug?** Open an issue.
- ✨ **Have an idea?** Start a discussion.
- 🔧 **Want to improve something?** Send a PR.

## License

MIT
