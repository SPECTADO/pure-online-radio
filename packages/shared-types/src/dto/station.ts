import { z } from "zod";

export const StationLinkPlatformSchema = z.enum([
  "WEBSITE",
  "FACEBOOK",
  "INSTAGRAM",
  "TWITTER",
  "YOUTUBE",
  "TIKTOK",
  "EMAIL",
  "OTHER",
]);
export type StationLinkPlatform = z.infer<typeof StationLinkPlatformSchema>;

export const StationLinkSchema = z.object({
  platform: StationLinkPlatformSchema,
  url: z.string().min(1),
  // Only really used (and shown) for OTHER, where the platform name alone isn't descriptive.
  label: z.string().optional(),
});
export type StationLinkDTO = z.infer<typeof StationLinkSchema>;

export const TimeFormatSchema = z.enum(["12h", "24h"]);
export type TimeFormat = z.infer<typeof TimeFormatSchema>;

export const StationSettingsSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  // API-relative streaming path (e.g. "/public/station/logo"), same
  // never-a-direct-MinIO-URL convention as song/jingle cover art.
  logoUrl: z.string().nullable(),
  links: z.array(StationLinkSchema),
  // Station-wide display preference (not per-manager) -- read by every clock
  // time shown in the control panel, e.g. lib/format.ts's formatTimeOfDay.
  timeFormat: TimeFormatSchema,
  // How far ahead the clock-wheel fill engine keeps the queue planned -- see
  // apps/api/src/scheduler/clockWheelEngine.ts.
  queuePlanningHorizonMinutes: z.number().int().positive(),
  // Fallback crossfade lengths for songs that don't set their own mix-in/out
  // duration -- see Song.mixInDurationMs/mixOutDurationMs and
  // packages/shared-types/src/lib/mixPoints.ts.
  defaultMixInDurationMs: z.number().int().nonnegative(),
  defaultMixOutDurationMs: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});
export type StationSettingsDTO = z.infer<typeof StationSettingsSchema>;

export const UpdateStationSettingsRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  links: z.array(StationLinkSchema),
  removeLogo: z.boolean().optional(),
  timeFormat: TimeFormatSchema.default("12h"),
  queuePlanningHorizonMinutes: z.coerce.number().int().positive().default(240),
  defaultMixInDurationMs: z.coerce.number().int().nonnegative().default(5000),
  defaultMixOutDurationMs: z.coerce.number().int().nonnegative().default(5000),
});
export type UpdateStationSettingsRequestDTO = z.infer<typeof UpdateStationSettingsRequestSchema>;
