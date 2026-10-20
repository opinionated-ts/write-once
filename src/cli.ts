import { defineCommand, runMain } from "citty";

import { runGenerate } from "./cli/generate.js";
import { createCliProgressReporter } from "./cli/progress.js";
import { formatDiagnostic } from "./diagnostics.js";
import { CLI_VERSION } from "./version.js";

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
    const progress = createCliProgressReporter({
      isTTY: process.stderr.isTTY,
      columns: process.stderr.columns,
      write: (text) => process.stderr.write(text),
    });
    const result = await (async () => {
      try {
        return await runGenerate({ configPath: args.config, onProgress: progress.report });
      } finally {
        progress.dispose();
      }
    })();

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
    version: CLI_VERSION,
    description: "Update generated destination blocks from source content.",
  },
  subCommands: {
    generate: generateCommand,
  },
});

await runMain(mainCommand);
