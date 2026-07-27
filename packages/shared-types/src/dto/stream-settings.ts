import { z } from "zod";

export const StreamCodecSchema = z.enum(["AAC", "MP3"]);
export type StreamCodec = z.infer<typeof StreamCodecSchema>;

export const StreamSettingsSchema = z.object({
  codec: StreamCodecSchema,
  lowBitrateKbps: z.number().int().positive(),
  highBitrateKbps: z.number().int().positive(),
  // Used by both pipelines: ffmpeg's -hls_time/-hls_list_size in standard
  // mode, GPAC's segdur/tsb in low-latency mode (see masterEncoder.ts /
  // llHlsEncoder.ts) -- segmentSeconds * segmentCount is the live-edge/
  // time-shift (DVR) window either way. Low-latency mode additionally
  // derives a much shorter internal LL-HLS "part" duration from
  // segmentSeconds; that part duration isn't separately user-configurable.
  segmentSeconds: z.number().int().positive(),
  segmentCount: z.number().int().positive(),
  lowLatencyEnabled: z.boolean(),
  updatedAt: z.string().datetime(),
});
export type StreamSettingsDTO = z.infer<typeof StreamSettingsSchema>;

function refineStreamSettings(
  data: { codec: StreamCodec; lowBitrateKbps: number; highBitrateKbps: number; lowLatencyEnabled: boolean },
  ctx: z.RefinementCtx,
): void {
  if (data.highBitrateKbps < data.lowBitrateKbps) {
    ctx.addIssue({
      code: "custom",
      message: "highBitrateKbps must be greater than or equal to lowBitrateKbps",
      path: ["highBitrateKbps"],
    });
  }
  // Low-latency mode packages audio as fragmented MP4 (CMAF) for real
  // EXT-X-PART/PRELOAD-HINT support (see llHlsEncoder.ts) -- MP3-in-fMP4
  // isn't part of Apple's HLS authoring spec and isn't a combination any
  // mainstream player reliably supports, unlike AAC-in-fMP4.
  if (data.lowLatencyEnabled && data.codec === "MP3") {
    ctx.addIssue({
      code: "custom",
      message: "Low Latency HLS requires the AAC codec (MP3-in-fMP4 isn't a supported HLS combination)",
      path: ["lowLatencyEnabled"],
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
