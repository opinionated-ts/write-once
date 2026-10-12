import { createError } from "@opinionated-ts/error-factory";

export const ConfigLoadError = createError({
  name: "ConfigLoadError",
  defaults: { message: "Could not load write-once configuration." },
  fixed: { code: "CONFIG_LOAD_ERROR" },
});
