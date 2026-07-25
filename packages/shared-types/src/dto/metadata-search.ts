import { z } from "zod";

/**
 * External song metadata lookup, backed by MusicBrainz (recording search) +
 * the Cover Art Archive (cover art keyed off the matched release) -- chosen
 * over Spotify/Discogs because both are free, open, and require no API
 * key/app registration, just a descriptive User-Agent header. Only
 * search-by-text is implemented; audio-fingerprint auto-identification
 * (AcoustID + the `fpcalc`/Chromaprint binary) is a future enhancement, not
 * built here -- see musicBrainzProvider.ts.
 */
export const MetadataSearchQuerySchema = z.object({
  title: z.string().min(1),
  artist: z.string().optional(),
});
export type MetadataSearchQueryDTO = z.infer<typeof MetadataSearchQuerySchema>;

export const MetadataSearchResultSchema = z.object({
  source: z.literal("musicbrainz"),
  externalId: z.string(),
  title: z.string(),
  artist: z.string().nullable(),
  album: z.string().nullable(),
  year: z.number().int().nullable(),
  coverArtUrl: z.string().nullable(),
});
export type MetadataSearchResultDTO = z.infer<typeof MetadataSearchResultSchema>;

/** Body for `POST /library/songs/:id/apply-metadata` -- the client echoes
 * back whichever search result the manager picked. */
export const ApplyMetadataRequestSchema = MetadataSearchResultSchema;
export type ApplyMetadataRequestDTO = z.infer<typeof ApplyMetadataRequestSchema>;
