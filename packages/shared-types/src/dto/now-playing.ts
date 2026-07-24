import { z } from "zod";
import { PlaybackModeSchema } from "./common.js";

export const NowPlayingSchema = z.object({
  isLive: z.boolean(), // false => "off air" / filler / silence
  type: z.enum(["track", "jingle", "external_relay", "filler", "silence"]),
  title: z.string().nullable(),
  artist: z.string().nullable(),
  album: z.string().nullable(),
  coverArtUrl: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  durationMs: z.number().int().positive().nullable(),
  mode: PlaybackModeSchema,
});
export type NowPlayingDTO = z.infer<typeof NowPlayingSchema>;
