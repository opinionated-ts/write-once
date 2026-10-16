import { defineConfig } from "@/config";

export default defineConfig({
  include: ["docs/**"],
  exclude: ["tests/**"],
  respectGitignore: true,
});
