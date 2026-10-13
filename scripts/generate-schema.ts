import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

import { writeOnceConfigSchema } from "./config-schema.js";

const schema = z.toJSONSchema(writeOnceConfigSchema, {
  target: "draft-2020-12",
  io: "input",
});

schema["$id"] = "https://unpkg.com/write-once@0.1.0/write-once.schema.json";
schema["title"] = "write-once JSON configuration";

await writeFile(resolve("write-once.schema.json"), `${JSON.stringify(schema, null, 2)}\n`);
