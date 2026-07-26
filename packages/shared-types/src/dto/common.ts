import { z } from "zod";

export const RoleSchema = z.enum(["MANAGER", "ADMIN"]);
export type Role = z.infer<typeof RoleSchema>;

export const MediaKindSchema = z.enum(["SONG", "JINGLE", "AD"]);
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

export const ScheduleTriggerTypeSchema = z.enum(["ONE_TIME", "WEEKLY", "INTERVAL", "PLAY_COUNT"]);
export type ScheduleTriggerType = z.infer<typeof ScheduleTriggerTypeSchema>;

export const ScheduleInsertionModeSchema = z.enum(["ASAP", "AT_TIME"]);
export type ScheduleInsertionMode = z.infer<typeof ScheduleInsertionModeSchema>;

export const ExternalStreamEndBehaviorSchema = z.enum(["NATURAL", "AT_TIME", "AFTER_DURATION"]);
export type ExternalStreamEndBehavior = z.infer<typeof ExternalStreamEndBehaviorSchema>;
