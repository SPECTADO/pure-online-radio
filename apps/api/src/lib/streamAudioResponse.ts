import type { Request, Response } from "express";
import { getObjectStream } from "./storage.js";

/** Shared by songs/jingles/ads `/:id/audio` preview routes -- passes the
 * incoming Range header straight through to MinIO and mirrors its response
 * headers/status back, so the browser's <audio> element can seek. */
export async function streamAudioResponse(
  req: Request,
  res: Response,
  fileKey: string,
  fallbackMimeType: string,
): Promise<void> {
  const range = req.headers.range;
  const { body, contentType, contentLength, contentRange, statusCode } = await getObjectStream(fileKey, range);

  res.status(statusCode);
  res.setHeader("Content-Type", contentType || fallbackMimeType);
  res.setHeader("Accept-Ranges", "bytes");
  if (contentLength !== undefined) res.setHeader("Content-Length", String(contentLength));
  if (contentRange) res.setHeader("Content-Range", contentRange);
  res.setHeader("Cache-Control", "private, max-age=300");
  body.pipe(res);
}
