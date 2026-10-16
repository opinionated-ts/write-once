import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const version = process.argv[2];

if (
  version === undefined ||
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
) {
  throw new Error("Expected a valid semantic version as the first argument.");
}

await writeFile(
  resolve(import.meta.dirname, "../src/version.ts"),
  `// Replaced by semantic-release before the package is built for publication.\nexport const CLI_VERSION = ${JSON.stringify(version)};\n`,
);
