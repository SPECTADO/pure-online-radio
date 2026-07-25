import { parseBuffer } from "music-metadata";

export interface ExtractedAudioMetadata {
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number;
  picture: { data: Buffer; mimeType: string } | null;
}

/**
 * Reads ID3v1/v2 (and FLAC/OGG/MP4-equivalent) tags plus duration straight
 * from the uploaded file's bytes -- no separate ffprobe pass needed, since
 * `music-metadata` reads container/stream headers itself.
 */
export async function extractAudioMetadata(
  buffer: Buffer,
  mimeType: string,
): Promise<ExtractedAudioMetadata> {
  const parsed = await parseBuffer(buffer, mimeType);
  const [picture] = parsed.common.picture ?? [];

  return {
    title: parsed.common.title?.trim() || null,
    artist: parsed.common.artist?.trim() || null,
    album: parsed.common.album?.trim() || null,
    durationMs: Math.round((parsed.format.duration ?? 0) * 1000),
    picture: picture ? { data: Buffer.from(picture.data), mimeType: picture.format } : null,
  };
}
