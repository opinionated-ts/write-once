import { oxfmtConfig } from "@opinionated-ts/config";
import { defineConfig } from "oxfmt";

export default defineConfig({
  ...oxfmtConfig,

  overrides: [
    {
      files: ["**/*.md", "**/*.mdx"],
      options: {
        embeddedLanguageFormatting: "off",
      },
    },
  ],
});
