import { createError } from "@opinionated-ts/error-factory";

export const ConfigValidationError = createError({
  name: "ConfigValidationError",
  defaults: { message: "Invalid write-once configuration." },
  fixed: { code: "CONFIG_VALIDATION_ERROR" },
});
