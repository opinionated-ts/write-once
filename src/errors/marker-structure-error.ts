import { createError } from "@opinionated-ts/error-factory";

export const MarkerStructureError = createError({
  name: "MarkerStructureError",
  defaults: {
    message: "Invalid fragment marker structure.",
  },
  fixed: {
    code: "MARKER_STRUCTURE_ERROR",
  },
});
