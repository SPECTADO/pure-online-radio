import type { MetadataSearchQueryDTO, MetadataSearchResultDTO } from "@spectado/shared-types";
import { config } from "../../../config/env.js";
import { logger } from "../../../logger.js";

/**
 * Song metadata auto-import, backed by MusicBrainz + the Cover Art Archive.
 * Picked over Spotify/Discogs/Last.fm: fully open data, no API key or app
 * registration, no request-quota approval process -- the only requirement is
 * a descriptive User-Agent header (MUSICBRAINZ_USER_AGENT), which is exactly
 * what self-hosting operators can set themselves without going through a
 * vendor developer portal.
 *
 * This only covers search-by-text (title/artist -> candidate matches). True
 * "auto-import" via audio fingerprinting would use AcoustID, which requires
 * generating a fingerprint with the Chromaprint `fpcalc` binary before ever
 * calling an HTTP API -- that's a real background-job/native-binary feature,
 * intentionally left as a future enhancement rather than built here.
 */

const MUSICBRAINZ_BASE_URL = "https://musicbrainz.org/ws/2";
const COVER_ART_BASE_URL = "https://coverartarchive.org";
const MAX_RESULTS = 8;

interface MusicBrainzRecording {
  id: string;
  title: string;
  length?: number;
  "artist-credit"?: Array<{ name: string }>;
  releases?: Array<{ id: string; title?: string; date?: string }>;
}

interface MusicBrainzSearchResponse {
  recordings?: MusicBrainzRecording[];
}

function buildLuceneQuery({ title, artist }: MetadataSearchQueryDTO): string {
  const escape = (value: string) => value.replace(/["\\]/g, "\\$&");
  const clauses = [`recording:"${escape(title)}"`];
  if (artist) clauses.push(`artist:"${escape(artist)}"`);
  return clauses.join(" AND ");
}

function extractYear(date: string | undefined): number | null {
  const match = date ? /^\d{4}/.exec(date) : null;
  return match ? Number(match[0]) : null;
}

/** HEAD-checks the Cover Art Archive so results don't advertise a cover image
 * that 404s once the manager tries to apply it. */
async function findCoverArtUrl(releases: MusicBrainzRecording["releases"]): Promise<string | null> {
  for (const release of releases ?? []) {
    const url = `${COVER_ART_BASE_URL}/release/${release.id}/front-250`;
    try {
      const res = await fetch(url, {
        method: "HEAD",
        headers: { "User-Agent": config.musicBrainzUserAgent },
      });
      if (res.ok) return url;
    } catch {
      // Cover Art Archive being unreachable shouldn't fail the whole search.
    }
  }
  return null;
}

export async function searchSongMetadata(
  query: MetadataSearchQueryDTO,
): Promise<MetadataSearchResultDTO[]> {
  const url = new URL(`${MUSICBRAINZ_BASE_URL}/recording`);
  url.searchParams.set("query", buildLuceneQuery(query));
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", String(MAX_RESULTS));

  const res = await fetch(url, {
    headers: {
      "User-Agent": config.musicBrainzUserAgent,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    logger.warn({ status: res.status }, "MusicBrainz search request failed");
    throw new Error(`MusicBrainz search failed with status ${res.status}`);
  }

  const body = (await res.json()) as MusicBrainzSearchResponse;

  return Promise.all(
    (body.recordings ?? []).slice(0, MAX_RESULTS).map(async (recording) => {
      const release = recording.releases?.[0];
      return {
        source: "musicbrainz" as const,
        externalId: recording.id,
        title: recording.title,
        artist: recording["artist-credit"]?.map((c) => c.name).join(", ") || null,
        album: release?.title ?? null,
        year: extractYear(release?.date),
        coverArtUrl: await findCoverArtUrl(recording.releases),
      };
    }),
  );
}

export async function fetchCoverArtImage(
  url: string,
): Promise<{ data: Buffer; mimeType: string } | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": config.musicBrainzUserAgent } });
    if (!res.ok) return null;
    const mimeType = res.headers.get("content-type") ?? "image/jpeg";
    const data = Buffer.from(await res.arrayBuffer());
    return { data, mimeType };
  } catch (err) {
    logger.warn({ err, url }, "failed to fetch cover art image");
    return null;
  }
}
