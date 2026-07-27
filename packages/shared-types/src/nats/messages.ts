import { z } from "zod";
import { PlaybackModeSchema } from "../dto/common.js";
import { NowPlayingSchema } from "../dto/now-playing.js";

/** Every command/status/control payload agreed on by api <-> encoder <-> control-panel. */

// --- commands (api -> encoder) ---

export const AdvanceCommandSchema = z.object({
  commandId: z.string(),
  requestedBy: z.string().nullable(),
  reason: z.enum(["skip", "manual-start", "scheduled"]),
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
  title: z.string(),
  durationMs: z.number().int().positive(),
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
  // null = no forced end -- run until the source itself stops (ExternalStreamEndBehavior.NATURAL).
  endAt: z.string().datetime().nullable(),
  onFailure: z.enum(["retry", "fallbackToQueue"]).default("fallbackToQueue"),
});
export type RelayStartCommand = z.infer<typeof RelayStartCommandSchema>;

export const RelayStopCommandSchema = z.object({ commandId: z.string(), relayId: z.string() });
export type RelayStopCommand = z.infer<typeof RelayStopCommandSchema>;

export const RelayCancelCommandSchema = z.object({ commandId: z.string(), relayId: z.string() });
export type RelayCancelCommand = z.infer<typeof RelayCancelCommandSchema>;

// --- encoder status (encoder -> api, api -> control-panel via re-broadcast or direct subscribe) ---

// 3x the encoder's default 5s heartbeat interval (HEARTBEAT_INTERVAL_MS) -- enough
// slack for a slow tick without flagging a merely-late heartbeat as down. Shared
// so the api's /status route and the control panel's own on-air badge (which
// re-derives staleness client-side between heartbeats, rather than polling
// /status) can't drift apart on what "stale" means.
export const HEARTBEAT_STALE_MS = 15_000;

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
  // Filename (not full path) of the most recent complete segment the active
  // HLS muxer (ffmpeg or, in low-latency mode, gpac) has written -- null
  // before the first segment closes, e.g. moments after a fresh spawn.
  currentSegment: z.string().nullable(),
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
  reason: z.enum(["auto", "manual-start", "skip", "scheduled"]),
});
export type QueueAdvancedStatus = z.infer<typeof QueueAdvancedStatusSchema>;

export const JingleStartedStatusSchema = z.object({
  ts: z.string().datetime(),
  jingleId: z.string(),
  title: z.string(),
  durationMs: z.number().int().positive(),
});
export type JingleStartedStatus = z.infer<typeof JingleStartedStatusSchema>;

export const JingleEndedStatusSchema = z.object({
  ts: z.string().datetime(),
  jingleId: z.string(),
});
export type JingleEndedStatus = z.infer<typeof JingleEndedStatusSchema>;

export const RelayStartedStatusSchema = z.object({
  ts: z.string().datetime(),
  relayId: z.string(),
});
export type RelayStartedStatus = z.infer<typeof RelayStartedStatusSchema>;

export const RelayEndedStatusSchema = z.object({
  ts: z.string().datetime(),
  relayId: z.string(),
});
export type RelayEndedStatus = z.infer<typeof RelayEndedStatusSchema>;

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
