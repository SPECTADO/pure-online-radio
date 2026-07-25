import multer from "multer";

// Keep in sync with `client_max_body_size` in apps/webserver/nginx/conf.d/default.conf's
// /api/ location -- nginx sits in front of this in every real deployment and
// defaults to a 1MB cap, so raising the limit here alone isn't enough.
const MAX_AUDIO_BYTES = 200 * 1024 * 1024; // 200MB -- generous for uncompressed WAV/FLAC uploads.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB -- cover art only.

function fileFilter(
  _req: unknown,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile?: boolean) => void,
) {
  if (file.fieldname === "coverArt" || file.fieldname === "logo") {
    cb(file.mimetype.startsWith("image/") ? null : new Error(`${file.fieldname} must be an image file`), true);
    return;
  }
  cb(file.mimetype.startsWith("audio/") ? null : new Error("file must be an audio file"), true);
}

/** In-memory storage: files are small enough (relative to container memory)
 * that streaming straight to a Buffer, then to MinIO in one PutObject call,
 * is simpler than juggling a temp-file + multipart S3 upload for v1. */
const storage = multer.memoryStorage();

/** Single required audio file under field name "file" -- jingles and ads. */
export const audioUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_AUDIO_BYTES },
}).single("file");

/** Audio file ("file") plus an optional cover art image ("coverArt") -- songs. */
export const songUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: Math.max(MAX_AUDIO_BYTES, MAX_IMAGE_BYTES) },
}).fields([
  { name: "file", maxCount: 1 },
  { name: "coverArt", maxCount: 1 },
]);

/** Single optional image file under field name "logo" -- station branding. */
export const stationLogoUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_IMAGE_BYTES },
}).single("logo");
