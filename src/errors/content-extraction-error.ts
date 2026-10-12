import { createError } from "@opinionated-ts/error-factory";

export const ContentExtractionError = createError({
  name: "ContentExtractionError",
  defaults: { message: "Could not extract source content." },
  fixed: { code: "CONTENT_EXTRACTION_ERROR" },
});
