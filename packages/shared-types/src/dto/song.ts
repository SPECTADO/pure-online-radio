import { z } from "zod";
import { CategorySchema } from "./category.js";

export const SongSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string().nullable(),
  durationMs: z.number().int().positive(),
  coverArtUrl: z.string().nullable(),
  categories: z.array(CategorySchema),
  tags: z.array(z.string()),
  isActive: z.boolean(),
  lastPlayedAt: z.string().datetime().nullable(),
  playCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  // Raw, possibly-unset crossfade points -- null means "use the station's
  // default mix-in/out duration" (see resolveMixPoints in
  // packages/shared-types/src/lib/mixPoints.ts, which the control panel also
  // calls to preview the effective value of an unset field).
  mixInPointMs: z.number().int().nonnegative().nullable(),
  mixInDurationMs: z.number().int().nonnegative().nullable(),
  mixOutPointMs: z.number().int().nonnegative().nullable(),
  mixOutDurationMs: z.number().int().nonnegative().nullable(),
});
export type SongDTO = z.infer<typeof SongSchema>;

/**
 * Validates the parsed fields of a multipart `POST /library/songs` request
 * (the audio file itself, and an optional cover art file, are handled
 * separately by multer -- this only covers the text fields). Any field left
 * unset falls back to the value auto-extracted from the file's ID3 tags.
 */
export const CreateSongRequestSchema = z.object({
  title: z.string().min(1).optional(),
  artist: z.string().min(1).optional(),
  album: z.string().optional(),
  categoryIds: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});
export type CreateSongRequestDTO = z.infer<typeof CreateSongRequestSchema>;

export const UpdateSongRequestSchema = z.object({
  title: z.string().min(1).optional(),
  artist: z.string().min(1).optional(),
  album: z.string().nullable().optional(),
  categoryIds: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  /** Set true to remove the current cover art without uploading a new one. */
  removeCoverArt: z.boolean().optional(),
  // Crossfade points -- explicit null resets the field to "use the station
  // default" (see SongSchema above); omitted leaves the current value alone.
  mixInPointMs: z.number().int().nonnegative().nullable().optional(),
  mixInDurationMs: z.number().int().nonnegative().nullable().optional(),
  mixOutPointMs: z.number().int().nonnegative().nullable().optional(),
  mixOutDurationMs: z.number().int().nonnegative().nullable().optional(),
});
export type UpdateSongRequestDTO = z.infer<typeof UpdateSongRequestSchema>;
