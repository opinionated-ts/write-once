import { defineConfig } from "write-once";

export default defineConfig({
  include: ["docs/**"],
  exclude: ["tests/**"],
  respectGitignore: true,
});
