import type { Readable } from "node:stream";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config/env.js";

/**
 * MinIO is S3-API-compatible, so the plain AWS SDK v3 S3 client works
 * unmodified against it -- `forcePathStyle` is the one setting MinIO actually
 * requires (virtual-hosted-style bucket URLs don't resolve for a
 * self-hosted, non-DNS-wildcarded endpoint).
 */
const s3 = new S3Client({
  endpoint: config.s3.endpoint,
  region: "us-east-1", // MinIO ignores this; the SDK requires some value.
  forcePathStyle: config.s3.forcePathStyle,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
});

const COVER_ART_URL_TTL_SECONDS = 3600;

export async function uploadObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }));
}

/**
 * MinIO is deliberately never given a published host port (see docker-compose.yml/README) --
 * so a presigned URL naming its internal `minio:9000` endpoint is only ever
 * fetchable from inside the compose network, never from a manager's browser.
 * This is fine for server-to-server consumers (e.g. the encoder's future
 * `/internal/playback/next` audio URL, resolved and used entirely inside the
 * Docker network) but NOT for anything rendered in the control panel --
 * browser-facing assets (cover art) must instead be streamed through an
 * authenticated API route with getObjectStream() below.
 */
export async function getPresignedGetUrl(
  key: string,
  ttlSeconds = COVER_ART_URL_TTL_SECONDS,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: config.s3.bucket, Key: key });
  return getSignedUrl(s3, command, { expiresIn: ttlSeconds });
}

export interface ObjectStream {
  body: Readable;
  contentType: string;
  contentLength?: number;
  contentRange?: string;
  /** 206 when `range` was honored, 200 for a full-object response. */
  statusCode: number;
}

/**
 * `range` is passed straight through to MinIO's own Range support (S3 API) --
 * used for audio preview playback, where the browser's `<audio>` element
 * issues Range requests on its own (seeking, and some browsers probe the
 * end of the file to read duration metadata even before playback starts).
 * Without this, larger files either fail to seek or don't play at all in
 * some browsers.
 */
export async function getObjectStream(key: string, range?: string): Promise<ObjectStream> {
  const result = await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key, Range: range }));
  return {
    body: result.Body as Readable,
    contentType: result.ContentType ?? "application/octet-stream",
    contentLength: result.ContentLength,
    contentRange: result.ContentRange,
    statusCode: result.$metadata.httpStatusCode ?? (range ? 206 : 200),
  };
}

// ── Object key layout ────────────────────────────────────────────────────
// Every library media type gets its own top-level "folder" (S3 key prefix),
// with each item further namespaced by its own id -- keeps the bucket
// browsable in the MinIO console and means deleting an item's folder never
// risks touching another item's files.

export function songAudioKey(songId: string, ext: string): string {
  return `songs/${songId}/original${ext}`;
}

export function songCoverArtKey(songId: string, ext: string): string {
  return `songs/${songId}/cover${ext}`;
}

export function jingleAudioKey(jingleId: string, ext: string): string {
  return `jingles/${jingleId}/original${ext}`;
}

export function adAudioKey(adId: string, ext: string): string {
  return `ads/${adId}/original${ext}`;
}

/** Singleton, unlike the per-item keys above -- there's only ever one station logo. */
export function stationLogoKey(ext: string): string {
  return `station/logo${ext}`;
}

const MIME_EXTENSIONS: Record<string, string> = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/flac": ".flac",
  "audio/x-flac": ".flac",
  "audio/ogg": ".ogg",
  "audio/aac": ".aac",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

/** Prefers the extension from the uploaded filename (preserves e.g. `.flac`
 * vs `.mp3` precisely); falls back to a mime-type table since some browsers/
 * clients send extension-less filenames for drag-and-drop uploads. */
export function extensionFor(originalFilename: string, mimeType: string): string {
  const match = /\.[a-zA-Z0-9]+$/.exec(originalFilename);
  if (match) return match[0].toLowerCase();
  return MIME_EXTENSIONS[mimeType] ?? "";
}
