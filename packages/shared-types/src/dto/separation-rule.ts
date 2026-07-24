import { z } from "zod";

export const SeparationRulesSchema = z.object({
  artistSeparationMinutes: z.number().int().nonnegative(),
  songSeparationMinutes: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});
export type SeparationRulesDTO = z.infer<typeof SeparationRulesSchema>;

export const UpdateSeparationRulesRequestSchema = z.object({
  artistSeparationMinutes: z.number().int().nonnegative(),
  songSeparationMinutes: z.number().int().nonnegative(),
});
export type UpdateSeparationRulesRequestDTO = z.infer<typeof UpdateSeparationRulesRequestSchema>;
