import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Request, Response } from "express";
import { logger } from "../logger.js";
import { getObjectStream } from "./storage.js";

/** Streams an S3 object body into the response. Never `body.pipe(res)`: pipe() attaches no
 * error listener to the source (a MinIO reset mid-stream is then an uncaught exception that
 * kills the whole api) and doesn't destroy it when the client aborts (every abandoned <audio>
 * Range request would keep a socket from the SDK's pool). pipeline() handles both. Headers are
 * already sent by the time this can fail, so errors are logged, never rethrown to Express. */
export async function pipeObjectToResponse(body: Readable, res: Response): Promise<void> {
  try {
    await pipeline(body, res);
  } catch (err) {
    // Client went away mid-stream (seek, closed tab) -- routine, not worth a log line.
    if ((err as NodeJS.ErrnoException).code === "ERR_STREAM_PREMATURE_CLOSE") return;
    logger.warn({ err }, "failed streaming object to response");
  }
}

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
  await pipeObjectToResponse(body, res);
}
