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

export const StationSettingsSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  // API-relative streaming path (e.g. "/public/station/logo"), same
  // never-a-direct-MinIO-URL convention as song/jingle cover art.
  logoUrl: z.string().nullable(),
  links: z.array(StationLinkSchema),
  updatedAt: z.string().datetime(),
});
export type StationSettingsDTO = z.infer<typeof StationSettingsSchema>;

export const UpdateStationSettingsRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  links: z.array(StationLinkSchema),
  removeLogo: z.boolean().optional(),
});
export type UpdateStationSettingsRequestDTO = z.infer<typeof UpdateStationSettingsRequestSchema>;
