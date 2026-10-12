import { createError } from "@opinionated-ts/error-factory";

export const MarkerSyntaxError = createError({
  name: "MarkerSyntaxError",
  defaults: {
    message: "Invalid fragment marker syntax.",
  },
  fixed: {
    code: "MARKER_SYNTAX_ERROR",
  },
});
