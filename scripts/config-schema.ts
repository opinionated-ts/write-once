import { z } from "zod";

export const writeOnceConfigSchema = z
  .object({
    root: z
      .string()
      .refine((value) => value.trim().length > 0)
      .optional(),
    include: z.array(z.string().refine((value) => value.trim().length > 0)).optional(),
    exclude: z.array(z.string().refine((value) => value.trim().length > 0)).optional(),
    respectGitignore: z.boolean().optional(),
  })
  .passthrough();
