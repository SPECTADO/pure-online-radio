import type { Request, Response } from "express";
import { getObjectStream } from "./storage.js";

/** Shared by songs/jingles/ads/voice-tracks `/:id/audio` preview routes -- passes the
 * incoming Range header straight through to MinIO and mirrors its response
 * headers/status back, so the browser's <audio> element can seek.
 *
 * `downloadFilename`, when set, adds `Content-Disposition: attachment` so the browser
 * shows a save dialog with a human-readable name instead of streaming inline for
 * playback -- used by the library's per-row "Download" links. */
export async function streamAudioResponse(
  req: Request,
  res: Response,
  fileKey: string,
  fallbackMimeType: string,
  downloadFilename?: string,
): Promise<void> {
  const range = req.headers.range;
  const { body, contentType, contentLength, contentRange, statusCode } = await getObjectStream(fileKey, range);

  res.status(statusCode);
  res.setHeader("Content-Type", contentType || fallbackMimeType);
  res.setHeader("Accept-Ranges", "bytes");
  if (contentLength !== undefined) res.setHeader("Content-Length", String(contentLength));
  if (contentRange) res.setHeader("Content-Range", contentRange);
  res.setHeader("Cache-Control", "private, max-age=300");
  if (downloadFilename) {
    // filename* (RFC 5987) carries the real UTF-8 name; the plain ASCII fallback keeps
    // older clients from mangling the response entirely.
    const asciiFallback = downloadFilename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(downloadFilename)}`,
    );
  }
  body.pipe(res);
}
