import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "./src/index.ts",
    schema: "./src/schema.ts",
    cli: "./src/cli.ts",
  },
  format: "esm",
  dts: true,
  clean: true,
  outputOptions: {
    banner: (chunk) => (chunk.fileName.includes("cli") ? "#!/usr/bin/env node" : ""),
  },
  exports: {
    bin: true,
    exclude: ["cli"],
  },
});
