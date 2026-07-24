import { z } from "zod";
import { JingleTypeSchema } from "./common.js";

export const JingleSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: JingleTypeSchema,
  tags: z.array(z.string()),
  durationMs: z.number().int().positive(),
  isActive: z.boolean(),
  lastPlayedAt: z.string().datetime().nullable(),
  playCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type JingleDTO = z.infer<typeof JingleSchema>;

export const CreateJingleRequestSchema = z.object({
  title: z.string().min(1),
  type: JingleTypeSchema.default("OTHER"),
  tags: z.array(z.string()).default([]),
});
export type CreateJingleRequestDTO = z.infer<typeof CreateJingleRequestSchema>;
