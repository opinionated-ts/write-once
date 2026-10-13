import { defineConfig } from "@opinionated-ts/write-once";

export default defineConfig({
  include: ["docs/**"],
  exclude: ["tests/**"],
  respectGitignore: true,
});
