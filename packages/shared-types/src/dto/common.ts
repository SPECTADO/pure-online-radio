import { z } from "zod";

export const RoleSchema = z.enum(["MANAGER", "ADMIN"]);
export type Role = z.infer<typeof RoleSchema>;

export const MediaKindSchema = z.enum(["SONG", "JINGLE"]);
export type MediaKind = z.infer<typeof MediaKindSchema>;

export const SelectionStrategySchema = z.enum(["RANDOM", "LEAST_OFTEN_PLAYED"]);
export type SelectionStrategy = z.infer<typeof SelectionStrategySchema>;

export const JingleTypeSchema = z.enum([
  "STATION_ID",
  "SWEEPER",
  "SFX",
  "PROMO",
  "ADVERT",
  "OTHER",
]);
export type JingleType = z.infer<typeof JingleTypeSchema>;

export const ScheduledItemStatusSchema = z.enum([
  "PENDING",
  "PLAYED",
  "SKIPPED",
  "CANCELLED",
]);
export type ScheduledItemStatus = z.infer<typeof ScheduledItemStatusSchema>;

export const ExternalStreamStatusSchema = z.enum([
  "SCHEDULED",
  "PLAYING",
  "STOPPED",
  "FAILED",
  "CANCELLED",
]);
export type ExternalStreamStatus = z.infer<typeof ExternalStreamStatusSchema>;

export const PlaybackModeSchema = z.enum(["LIVE", "MANUAL"]);
export type PlaybackMode = z.infer<typeof PlaybackModeSchema>;

export const WeekdaySchema = z.number().int().min(0).max(6); // 0=Sun..6=Sat
export type Weekday = z.infer<typeof WeekdaySchema>;
