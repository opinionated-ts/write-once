import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

import { writeOnceConfigSchema } from "./config-schema.js";

const schema = z.toJSONSchema(writeOnceConfigSchema, {
  target: "draft-2020-12",
  io: "input",
});

// Increment only when the generated configuration contract changes.
const schemaVersion = 1;

schema["$id"] = "https://unpkg.com/write-once/write-once.schema.json";
schema["title"] = "write-once JSON configuration";
schema["x-write-once-schema-version"] = schemaVersion;

await writeFile(resolve("write-once.schema.json"), `${JSON.stringify(schema, null, 2)}\n`);
