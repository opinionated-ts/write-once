import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    fsModuleCache: true,
    coverage: {
      provider: "istanbul",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      thresholds: {
        branches: 90,
        statements: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
