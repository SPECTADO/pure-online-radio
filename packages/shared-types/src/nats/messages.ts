import { z } from "zod";
import { PlaybackModeSchema } from "../dto/common.js";
import { NowPlayingSchema } from "../dto/now-playing.js";

/** Every command/status/control payload agreed on by api <-> encoder <-> control-panel. */

// --- commands (api -> encoder) ---

export const AdvanceCommandSchema = z.object({
  commandId: z.string(),
  requestedBy: z.string().nullable(),
  reason: z.enum(["skip", "manual-start"]),
});
export type AdvanceCommand = z.infer<typeof AdvanceCommandSchema>;

export const SetModeCommandSchema = z.object({
  commandId: z.string(),
  mode: PlaybackModeSchema,
});
export type SetModeCommand = z.infer<typeof SetModeCommandSchema>;

export const JinglePlayCommandSchema = z.object({
  commandId: z.string(),
  jingleId: z.string(),
  url: z.string().url(),
  duckDb: z.number().default(-14),
  fadeInMs: z.number().int().nonnegative().default(300),
  fadeOutMs: z.number().int().nonnegative().default(800),
});
export type JinglePlayCommand = z.infer<typeof JinglePlayCommandSchema>;

export const JingleStopCommandSchema = z.object({ commandId: z.string() });
export type JingleStopCommand = z.infer<typeof JingleStopCommandSchema>;

export const LiveStartCommandSchema = z.object({
  commandId: z.string(),
  sessionId: z.string(),
  token: z.string(),
  expiresAt: z.string().datetime(),
});
export type LiveStartCommand = z.infer<typeof LiveStartCommandSchema>;

export const LiveStopCommandSchema = z.object({
  commandId: z.string(),
  sessionId: z.string(),
});
export type LiveStopCommand = z.infer<typeof LiveStopCommandSchema>;

export const RelayStartCommandSchema = z.object({
  commandId: z.string(),
  relayId: z.string(),
  url: z.string().url(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  onFailure: z.enum(["retry", "fallbackToQueue"]).default("fallbackToQueue"),
});
export type RelayStartCommand = z.infer<typeof RelayStartCommandSchema>;

export const RelayStopCommandSchema = z.object({ commandId: z.string(), relayId: z.string() });
export type RelayStopCommand = z.infer<typeof RelayStopCommandSchema>;

export const RelayCancelCommandSchema = z.object({ commandId: z.string(), relayId: z.string() });
export type RelayCancelCommand = z.infer<typeof RelayCancelCommandSchema>;

// --- encoder status (encoder -> api, api -> control-panel via re-broadcast or direct subscribe) ---

export const HeartbeatStatusSchema = z.object({
  ts: z.string().datetime(),
  uptimeSec: z.number().nonnegative(),
  activeSlots: z.object({
    primary: z.enum(["track", "filler", "relay", "none"]),
    jingle: z.boolean(),
    mic: z.boolean(),
  }),
  mixerUnderruns: z.number().int().nonnegative(),
  hlsWriterHealthy: z.boolean(),
});
export type HeartbeatStatus = z.infer<typeof HeartbeatStatusSchema>;

export const NowPlayingStatusSchema = NowPlayingSchema.extend({
  ts: z.string().datetime(),
  trackId: z.string().nullable(),
});
export type NowPlayingStatus = z.infer<typeof NowPlayingStatusSchema>;

export const QueueAdvancedStatusSchema = z.object({
  ts: z.string().datetime(),
  previousTrackId: z.string().nullable(),
  currentTrackId: z.string().nullable(),
  reason: z.enum(["auto", "manual-start", "skip"]),
});
export type QueueAdvancedStatus = z.infer<typeof QueueAdvancedStatusSchema>;

export const ErrorStatusSchema = z.object({
  ts: z.string().datetime(),
  severity: z.enum(["warning", "critical"]),
  component: z.string(),
  message: z.string(),
  willRetry: z.boolean(),
});
export type ErrorStatus = z.infer<typeof ErrorStatusSchema>;

export const CommandAckStatusSchema = z.object({
  commandId: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
});
export type CommandAckStatus = z.infer<typeof CommandAckStatusSchema>;

// --- control broadcasts (api -> control-panel, not encoder-originated) ---

export const ModeControlBroadcastSchema = z.object({
  ts: z.string().datetime(),
  mode: PlaybackModeSchema,
});
export type ModeControlBroadcast = z.infer<typeof ModeControlBroadcastSchema>;

export const QueueUpdatedBroadcastSchema = z.object({
  ts: z.string().datetime(),
  reason: z.string(),
});
export type QueueUpdatedBroadcast = z.infer<typeof QueueUpdatedBroadcastSchema>;

export const AlertBroadcastSchema = z.object({
  ts: z.string().datetime(),
  level: z.enum(["info", "warning", "error"]),
  code: z.string(),
  message: z.string(),
});
export type AlertBroadcast = z.infer<typeof AlertBroadcastSchema>;
