import { z } from "zod";
import { JingleTypeSchema } from "./common.js";
import { CategorySchema } from "./category.js";

export const JingleSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: JingleTypeSchema,
  tags: z.array(z.string()),
  categories: z.array(CategorySchema),
  durationMs: z.number().int().positive(),
  isActive: z.boolean(),
  lastPlayedAt: z.string().datetime().nullable(),
  playCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type JingleDTO = z.infer<typeof JingleSchema>;

/** Parsed text fields of a multipart `POST /library/jingles` request -- the
 * audio file itself is handled separately by multer. Unlike songs, a jingle
 * has no artist/album: title (ID3 "title", editable) is its only metadata. */
export const CreateJingleRequestSchema = z.object({
  title: z.string().min(1).optional(),
  type: JingleTypeSchema.default("OTHER"),
  tags: z.array(z.string()).default([]),
  categoryIds: z.array(z.string()).default([]),
});
export type CreateJingleRequestDTO = z.infer<typeof CreateJingleRequestSchema>;

export const UpdateJingleRequestSchema = z.object({
  title: z.string().min(1).optional(),
  type: JingleTypeSchema.optional(),
  tags: z.array(z.string()).optional(),
  categoryIds: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateJingleRequestDTO = z.infer<typeof UpdateJingleRequestSchema>;
