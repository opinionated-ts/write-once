import { semanticReleaseConfig } from "@opinionated-ts/config";
import { type Options } from "semantic-release";

export default {
  ...semanticReleaseConfig,

  plugins: [
    ...semanticReleaseConfig.plugins,

    [
      "@semantic-release/exec",
      {
        prepareCmd: "bun run scripts/set-cli-version.ts ${nextRelease.version}",
      },
    ],
    "@semantic-release/npm", // → publish to npm if needed
  ],
} satisfies Options;
