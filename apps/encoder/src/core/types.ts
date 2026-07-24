/**
 * Core PCM bus constants and shared interfaces.
 *
 * Canonical bus format (do not change without updating the ffmpeg -f f32le
 * input args in process/masterEncoder.ts to match):
 *   - 32-bit float PCM, interleaved stereo ("f32le")
 *   - 48000 Hz sample rate
 *   - 20ms frames
 *
 * 48000 Hz * 0.02s = 960 samples/channel/frame; * 2 channels = 1920 samples/frame;
 * * 4 bytes/float32 = 7680 bytes/frame.
 */
export const SAMPLE_RATE_HZ = 48_000;
export const CHANNELS = 2;
export const FRAME_MS = 20;
export const SAMPLES_PER_CHANNEL_PER_FRAME = (SAMPLE_RATE_HZ * FRAME_MS) / 1000;
export const FRAME_SAMPLES = SAMPLES_PER_CHANNEL_PER_FRAME * CHANNELS;
export const BYTES_PER_FLOAT32 = 4;
export const FRAME_BYTES = FRAME_SAMPLES * BYTES_PER_FLOAT32;

/**
 * A single audio producer feeding the mixer. Every concrete source (filler
 * tone, decoded queue track, jingle overlay, live mic, external relay,
 * crossfade transition, ...) implements this the same way: hand back exactly
 * one 20ms frame per call, or `null` if a frame isn't available right now
 * (e.g. a decode source that hasn't buffered enough audio yet, or a stub that
 * hasn't been implemented). Returning `null` must never throw and must never
 * block - the mixer tick is real-time and a slow/blocking source would stall
 * the whole bus.
 */
export interface Source {
  /**
   * Returns the next 20ms frame as a Float32Array of exactly FRAME_SAMPLES
   * (1920) interleaved stereo samples, or `null` if no frame is currently
   * available (underrun / not implemented / waiting for data).
   */
  getFrame(): Float32Array | null;
}

/**
 * Describes a time-varying linear gain multiplier applied to a source before
 * it is summed onto the bus - used by jingle ducking (duck the primary bus
 * while a jingle plays, per JinglePlayCommand.duckDb) and by fade in/out
 * envelopes (JinglePlayCommand.fadeInMs / fadeOutMs, transitionSource
 * crossfades). Not wired into the mixer yet in this pass (see mixer.ts); the
 * shape exists now so jingle/transition stubs can declare the envelopes
 * they'll eventually produce.
 */
export interface GainEnvelope {
  /** Linear gain multiplier (0 = silent, 1 = unity) at `elapsedMs` since the envelope started. */
  gainAt(elapsedMs: number): number;
  /** Total duration of the envelope in ms, or `null` for an envelope that holds steady indefinitely. */
  readonly durationMs: number | null;
}

/** Which mixing slot a source occupies - mirrors HeartbeatStatus.activeSlots. */
export type SlotKind = "primary" | "jingle" | "mic";

/** What the primary slot is currently playing - mirrors HeartbeatStatus.activeSlots.primary. */
export type PrimarySlotKind = "track" | "filler" | "relay" | "none";

/**
 * A source mounted into a mixing slot, with an optional gain envelope. Only
 * `primary` is wired up to the real mixer today (always the filler source);
 * `jingle` and `mic` slots exist as a type-level placeholder for the overlay
 * design described in core/mixer.ts.
 */
export interface Slot {
  kind: SlotKind;
  source: Source;
  gain: GainEnvelope | null;
}
