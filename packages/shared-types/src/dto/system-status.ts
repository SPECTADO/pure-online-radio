import { z } from "zod";

export const ComponentHealthSchema = z.enum(["ok", "degraded", "error", "unknown"]);
export type ComponentHealth = z.infer<typeof ComponentHealthSchema>;

export const ComponentStatusSchema = z.object({
  key: z.string(),
  label: z.string(),
  health: ComponentHealthSchema,
  uptimeSec: z.number().nonnegative().nullable(),
  message: z.string().nullable(),
  // Only ever set for the "encoder" component -- the filename of the segment
  // it's currently writing (see HeartbeatStatus.currentSegment). Null for
  // every other component, and for encoder itself before a heartbeat with a
  // segment has arrived.
  currentSegment: z.string().nullable(),
});
export type ComponentStatusDTO = z.infer<typeof ComponentStatusSchema>;

export const MediaKindStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
});
export type MediaKindStatsDTO = z.infer<typeof MediaKindStatsSchema>;

export const CategoryLibraryStatsSchema = z.object({
  categoryId: z.string(),
  categoryName: z.string(),
  activeSongs: z.number().int().nonnegative(),
  activeJingles: z.number().int().nonnegative(),
  activeAds: z.number().int().nonnegative(),
});
export type CategoryLibraryStatsDTO = z.infer<typeof CategoryLibraryStatsSchema>;

export const LibraryStatsSchema = z.object({
  songs: MediaKindStatsSchema,
  jingles: MediaKindStatsSchema,
  ads: MediaKindStatsSchema,
  byCategory: z.array(CategoryLibraryStatsSchema),
});
export type LibraryStatsDTO = z.infer<typeof LibraryStatsSchema>;

export const StorageKindStatsSchema = z.object({
  objectCount: z.number().int().nonnegative(),
  totalBytes: z.number().nonnegative(),
});
export type StorageKindStatsDTO = z.infer<typeof StorageKindStatsSchema>;

/** Real MinIO/S3 object listing, bucketed by the `{kind}/{id}/...` key prefix
 * convention (see apps/api/src/lib/storage.ts) -- not derived from the DB's
 * fileSizeBytes columns, so it also reflects cover art and any orphaned
 * objects, i.e. what MinIO is actually storing. */
export const StorageStatsSchema = z.object({
  totalBytes: z.number().nonnegative(),
  totalObjectCount: z.number().int().nonnegative(),
  songs: StorageKindStatsSchema,
  jingles: StorageKindStatsSchema,
  ads: StorageKindStatsSchema,
  voiceTracks: StorageKindStatsSchema,
});
export type StorageStatsDTO = z.infer<typeof StorageStatsSchema>;

export const QueueStatsSchema = z.object({
  // Everything actually eligible to play now or via rotation -- due one-off
  // items, clock-wheel-filled items, and manually-queued ones. Excludes
  // schedule-rule items still waiting for a future fire time (see
  // /schedule/upcoming for those), same "queue" definition GET /queue uses.
  total: z.number().int().nonnegative(),
  manual: z.number().int().nonnegative(),
});
export type QueueStatsDTO = z.infer<typeof QueueStatsSchema>;

// Nullable rather than a schema-wide try/catch -- library/storage/queue stats
// each depend on a backing service (Postgres/MinIO) that the "components"
// section above may simultaneously be reporting as down. null means "that
// service was unreachable when this was gathered", not "zero" -- the two
// must render differently or a down MinIO would misleadingly look like an
// empty bucket.
export const SystemStatusSchema = z.object({
  generatedAt: z.string().datetime(),
  components: z.array(ComponentStatusSchema),
  library: LibraryStatsSchema.nullable(),
  storage: StorageStatsSchema.nullable(),
  queue: QueueStatsSchema.nullable(),
});
export type SystemStatusDTO = z.infer<typeof SystemStatusSchema>;
