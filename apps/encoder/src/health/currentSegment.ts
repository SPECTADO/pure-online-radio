import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Reads the "low" variant's live HLS playlist and returns the filename (not
 * full path) of its most recent complete segment, or null if the playlist
 * doesn't exist yet or has no segments (e.g. moments after a fresh spawn,
 * before the first segment closes).
 *
 * Works unchanged for both MasterEncoder (ffmpeg's own mpegts .ts segments)
 * and LowLatencyEncoder (gpac's fMP4/CMAF .m4s segments) since both write a
 * standard `<hlsOutputDir>/low/playlist.m3u8` -- reading the playlist itself
 * (the authoritative "what's live right now") beats guessing either muxer's
 * segment-naming convention or racing a directory listing against
 * in-progress writes. LL-HLS's `#EXT-X-PART`/`#EXT-X-PRELOAD-HINT` lines
 * carry their URI as a tag attribute rather than a bare line, so scanning for
 * the last non-"#" line naturally skips partial segments and lands on the
 * last complete one.
 */
export function getCurrentSegmentFilename(hlsOutputDir: string): string | null {
  const playlistPath = path.join(hlsOutputDir, "low", "playlist.m3u8");
  let contents: string;
  try {
    contents = fs.readFileSync(playlistPath, "utf8");
  } catch {
    return null;
  }

  const lines = contents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines.reverse()) {
    if (!line.startsWith("#")) {
      return path.basename(line);
    }
  }
  return null;
}
