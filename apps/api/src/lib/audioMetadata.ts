import { parseBuffer } from "music-metadata";

export interface ExtractedAudioMetadata {
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number;
  picture: { data: Buffer; mimeType: string } | null;
}

/** Upload handlers reject a file whose duration came back as 0 (see extractAudioMetadata) with
 * a 400 *before* uploading/creating anything -- every response DTO requires a positive
 * durationMs, so letting one through would 500 the create (after the row commits) and then
 * every list that includes the row. */
export const UNKNOWN_DURATION_ERROR =
  "could not determine the audio duration of this file -- re-export it (e.g. as MP3/WAV/FLAC) and try again";

/**
 * Reads ID3v1/v2 (and FLAC/OGG/MP4-equivalent) tags plus duration straight
 * from the uploaded file's bytes -- no separate ffprobe pass needed, since
 * `music-metadata` reads container/stream headers itself. `duration: true`
 * makes it scan the stream when the headers don't carry a duration
 * (e.g. MediaRecorder WebM, headerless VBR MP3); `durationMs` is still 0
 * when even that fails -- callers must reject that (UNKNOWN_DURATION_ERROR).
 */
export async function extractAudioMetadata(
  buffer: Buffer,
  mimeType: string,
): Promise<ExtractedAudioMetadata> {
  const parsed = await parseBuffer(buffer, mimeType, { duration: true });
  const [picture] = parsed.common.picture ?? [];

  return {
    title: parsed.common.title?.trim() || null,
    artist: parsed.common.artist?.trim() || null,
    album: parsed.common.album?.trim() || null,
    durationMs: Math.round((parsed.format.duration ?? 0) * 1000),
    picture: picture ? { data: Buffer.from(picture.data), mimeType: picture.format } : null,
  };
}
