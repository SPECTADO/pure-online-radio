import { z } from "zod";

export const VoiceTrackSchema = z.object({
  id: z.string(),
  title: z.string(),
  durationMs: z.number().int().positive(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
});
export type VoiceTrackDTO = z.infer<typeof VoiceTrackSchema>;

/** Parsed text fields of a multipart `POST /library/voice-tracks` request -- the audio file
 * itself is handled separately by multer. No type/tags/categories (see the model's own
 * comment in schema.prisma for why): title is the only metadata, same convention as jingles. */
export const CreateVoiceTrackRequestSchema = z.object({
  title: z.string().min(1).optional(),
});
export type CreateVoiceTrackRequestDTO = z.infer<typeof CreateVoiceTrackRequestSchema>;

export const UpdateVoiceTrackRequestSchema = z.object({
  title: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateVoiceTrackRequestDTO = z.infer<typeof UpdateVoiceTrackRequestSchema>;
