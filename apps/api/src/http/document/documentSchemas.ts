import { z } from "zod";

export const DocumentKindParamsSchema = z.object({ kind: z.string().min(1).max(64) });

/** One problem in a template, as a code and where — the editor translates and marks it. */
export const DocumentTemplateIssueSchema = z.object({
  code: z.string(),
  line: z.number().int().optional(),
  column: z.number().int().optional(),
  variable: z.string().optional(),
  filter: z.string().optional(),
});

/** Long enough for a long contract; the engine caps the source the same way. */
export const DocumentBodySchema = z.string().max(100_000);
