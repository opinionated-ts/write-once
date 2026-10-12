import { defineCommand, runMain } from "citty";

import { runGenerate } from "./cli/generate.js";
import { formatDiagnostic } from "./diagnostics.js";

const generateCommand = defineCommand({
  meta: {
    name: "generate",
    description: "Generate configured destination files.",
  },
  args: {
    config: {
      type: "string",
      alias: "c",
      description: "Select a config file.",
    },
  },
  async run({ args }) {
    const result = await runGenerate({ configPath: args.config });

    for (const diagnostic of result.diagnostics) {
      console.error(formatDiagnostic(diagnostic));
    }

    if (result.exitCode === 0) {
      if (result.discoveredCount === 0) {
        console.log("No destination files to generate.");
      } else {
        console.log(
          `Updated ${result.written.length} of ${result.discoveredCount} destination files; ${result.unchanged.length} unchanged.`,
        );
      }
    } else if (result.written.length > 0) {
      console.log(`Updated ${result.written.length} destination file(s) before the write failure.`);
    }

    process.exitCode = result.exitCode;
  },
});

const mainCommand = defineCommand({
  meta: {
    name: "write-once",
    version: "0.1.0",
    description: "Update generated destination blocks from source content.",
  },
  subCommands: {
    generate: generateCommand,
  },
});

await runMain(mainCommand);
