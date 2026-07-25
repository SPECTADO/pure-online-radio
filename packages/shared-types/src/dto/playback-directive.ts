import { z } from "zod";

/**
 * Response contract for GET /internal/playback/next — the encoder's only
 * source of truth for "what should play now". `url` is always a short-lived
 * presigned MinIO GET URL; the encoder never holds its own storage credentials.
 */
export const TrackDirectiveSchema = z.object({
  type: z.literal("track"),
  requestId: z.string(), // idempotency key: retries of the same requestId must not double-consume state
  mediaKind: z.enum(["SONG", "JINGLE", "AD"]),
  mediaId: z.string(),
  title: z.string(),
  artist: z.string().nullable(),
  // API-relative path (e.g. "/library/songs/{id}/cover-art"), same convention
  // as SongDTO.coverArtUrl -- null for jingles/ads, which have no cover art.
  coverArtUrl: z.string().nullable(),
  durationMs: z.number().int().positive(),
  url: z.string().url(),
  urlExpiresAt: z.string().datetime(),
});
export type TrackDirectiveDTO = z.infer<typeof TrackDirectiveSchema>;

export const ExternalRelayDirectiveSchema = z.object({
  type: z.literal("external_relay"),
  requestId: z.string(),
  relayId: z.string(),
  url: z.string().url(),
  until: z.string().datetime(),
});
export type ExternalRelayDirectiveDTO = z.infer<typeof ExternalRelayDirectiveSchema>;

export const SilenceDirectiveSchema = z.object({
  type: z.literal("silence"),
  requestId: z.string(),
  reason: z.enum(["queue-empty", "library-empty", "resolution-error"]),
  retryAfterMs: z.number().int().positive(),
});
export type SilenceDirectiveDTO = z.infer<typeof SilenceDirectiveSchema>;

export const PlaybackDirectiveSchema = z.discriminatedUnion("type", [
  TrackDirectiveSchema,
  ExternalRelayDirectiveSchema,
  SilenceDirectiveSchema,
]);
export type PlaybackDirectiveDTO = z.infer<typeof PlaybackDirectiveSchema>;
