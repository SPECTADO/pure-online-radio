/**
 * multer puts every non-file field of a `multipart/form-data` body onto
 * `req.body` as a plain string (or string[] if the field repeats) -- there's
 * no JSON parsing step like `express.json()` does. Array-shaped fields
 * (categoryIds, tags) are sent by the control panel as a single JSON-encoded
 * string field; this also tolerates a plain comma-separated fallback for any
 * other client (e.g. curl/Postman) that doesn't want to bother JSON-encoding.
 */
export function parseJsonArrayField(value: unknown): string[] {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // Not JSON -- fall through to comma-split below.
  }
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** multer/express represent an absent optional string field as `undefined`,
 * but a body field explicitly sent as "" should still be treated as unset. */
export function optionalStringField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim() === "" ? undefined : value;
}

/**
 * Same "leave alone if absent" convention as optionalStringField, but for
 * nullable numeric fields (e.g. Song.mixInPointMs) where the control panel
 * needs a third state beyond "unset"/"a value": explicitly resetting the
 * field back to null (e.g. "use the station default"). The literal string
 * "null" is how the control panel spells that reset over multipart/form-data,
 * which otherwise has no way to send a real `null`.
 */
export function optionalNumberField(value: unknown): number | null | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  if (value === "null") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
