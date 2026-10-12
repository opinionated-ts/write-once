import { createError } from "@opinionated-ts/error-factory";

export const SourceResolutionError = createError({
  name: "SourceResolutionError",
  defaults: { message: "Could not resolve local source." },
  fixed: { code: "SOURCE_RESOLUTION_ERROR" },
});
