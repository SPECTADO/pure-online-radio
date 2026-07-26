import { z } from "zod";

export const StreamCodecSchema = z.enum(["AAC", "MP3"]);
export type StreamCodec = z.infer<typeof StreamCodecSchema>;

export const StreamSettingsSchema = z.object({
  codec: StreamCodecSchema,
  lowBitrateKbps: z.number().int().positive(),
  highBitrateKbps: z.number().int().positive(),
  // Standard-mode segment duration/count -- ignored in favor of a fixed short
  // duration (see apps/encoder/src/process/masterEncoder.ts) while
  // lowLatencyEnabled is true. segmentSeconds * segmentCount is the
  // live-edge/time-shift (DVR) window in both modes.
  segmentSeconds: z.number().int().positive(),
  segmentCount: z.number().int().positive(),
  lowLatencyEnabled: z.boolean(),
  updatedAt: z.string().datetime(),
});
export type StreamSettingsDTO = z.infer<typeof StreamSettingsSchema>;

function refineStreamSettings(
  data: { lowBitrateKbps: number; highBitrateKbps: number },
  ctx: z.RefinementCtx,
): void {
  if (data.highBitrateKbps < data.lowBitrateKbps) {
    ctx.addIssue({
      code: "custom",
      message: "highBitrateKbps must be greater than or equal to lowBitrateKbps",
      path: ["highBitrateKbps"],
    });
  }
}

export const UpdateStreamSettingsRequestSchema = z
  .object({
    codec: StreamCodecSchema,
    lowBitrateKbps: z.number().int().min(32).max(320),
    highBitrateKbps: z.number().int().min(32).max(320),
    segmentSeconds: z.number().int().min(1).max(30),
    segmentCount: z.number().int().min(3).max(30),
    lowLatencyEnabled: z.boolean(),
  })
  .superRefine(refineStreamSettings);
export type UpdateStreamSettingsRequestDTO = z.infer<typeof UpdateStreamSettingsRequestSchema>;
