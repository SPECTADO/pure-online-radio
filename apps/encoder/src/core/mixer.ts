import type { FifoWriter } from "./fifoWriter.js";
import { dbToLinear } from "./gainEnvelope.js";
import type { Logger } from "../util/logger.js";
import type { GainEnvelope, PrimarySlotKind, Source } from "./types.js";
import { FRAME_MS, FRAME_SAMPLES, FRAME_BYTES } from "./types.js";

const FRAME_MS_NS = BigInt(FRAME_MS) * 1_000_000n;
const SILENCE_FRAME = Buffer.alloc(FRAME_BYTES); // all-zero f32le frame, for the raw fifo-write fallback
const ZERO_SAMPLES = new Float32Array(FRAME_SAMPLES); // stand-in for a momentarily-underrun source during mixing

interface JingleSlot {
  source: Source;
  envelope: GainEnvelope;
  /** Linear gain applied to the primary bus when this jingle is fully faded in (JinglePlayCommand.duckDb, converted). */
  duckGainLinear: number;
}

/** How long a full duck-in (mic connects) / duck-out (mic disconnects) fade takes, in ms --
 * a manager-perceptible fade, not an anti-click ramp like the jingle envelope's ms-scale fades. */
const MIC_DUCK_FADE_MS = 1000;
const MIC_DUCK_STEP_PER_FRAME = FRAME_MS / MIC_DUCK_FADE_MS;

/**
 * Real-time audio graph, ticked once per 20ms frame via a drift-corrected
 * timer (see the tick-scheduling comment below -- that part is unchanged
 * from the original scaffold pass).
 *
 * Primary bus: exactly one `Source` at a time (queue track / silence / relay
 * / filler), swapped via `setPrimarySource` by queueController.
 *
 * Jingle overlay: 0 or 1 `Source` mounted via `setJingleSource` by
 * jingleController. When mounted, both the jingle's own fade envelope AND the
 * ducking gain applied to the primary bus are driven by the *same*
 * `GainEnvelope` (JingleGainEnvelope, see core/gainEnvelope.ts): the jingle is
 * at 0 gain (silent, not yet started) exactly when the primary is at full
 * volume, and the jingle is at full gain exactly when the primary is ducked
 * down to `duckGainLinear` -- one envelope drives both, ramping in lockstep.
 * The summed signal is soft-limited (`Math.tanh` per-sample) since two
 * sources summed can exceed +/-1.0; the tanh curve is applied only while a
 * jingle is actually mixed in, to avoid touching primary-only fidelity.
 *
 * Mic overlay: 0 or 1 `Source` mounted via `setMicSource` by liveMicController, summed onto the
 * bus at unity gain (the browser applies its own mic-volume gain before encoding -- see
 * liveMicBroadcast.ts -- so the mixer never scales the mic signal itself). What the mixer *does*
 * own is the primary bus's duck: `micDuckGain` continuously ramps toward `micDuckTargetLinear`
 * (the manager's "music volume" slider, `setMicDuckTarget`) while a mic is mounted, and back
 * toward 1.0 once it's cleared -- a fade in both directions (`MIC_DUCK_FADE_MS`), not an instant
 * snap, and it keeps ramping after `clearMicSource()` even though `hasOverlaySamples` has already
 * gone false by then (see the ramp-without-summing branch in `tick()`).
 */
export class Mixer {
  private primarySource: Source;
  private primaryKind: PrimarySlotKind;
  private jingleSlot: JingleSlot | null = null;
  private jingleElapsedFrames = 0;
  private micSource: Source | null = null;
  /** Target linear gain for the primary bus while a mic is live (the manager's "music volume" slider). */
  private micDuckTargetLinear = 0.3;
  /** Actual, continuously-ramped primary-bus gain -- chases micDuckTargetLinear while a mic is
   * mounted, chases 1.0 (full volume) once it's cleared. See MIC_DUCK_FADE_MS. */
  private micDuckGain = 1;
  private timer: NodeJS.Timeout | null = null;
  private startTimeNs = 0n;
  private frameCount = 0;
  private underruns = 0;
  private running = false;

  constructor(
    initialPrimarySource: Source,
    initialPrimaryKind: PrimarySlotKind,
    private readonly fifoWriter: FifoWriter,
    private readonly logger: Logger,
  ) {
    this.primarySource = initialPrimarySource;
    this.primaryKind = initialPrimaryKind;
  }

  /** Swaps the active primary source (e.g. silence -> queue track). */
  setPrimarySource(source: Source, kind: PrimarySlotKind): void {
    this.primarySource = source;
    this.primaryKind = kind;
  }

  get primarySlotKind(): PrimarySlotKind {
    return this.primaryKind;
  }

  /** Mounts a jingle overlay. `duckDb` is the JinglePlayCommand's ducking depth (dB, typically negative). */
  setJingleSource(source: Source, envelope: GainEnvelope, duckDb: number): void {
    this.jingleSlot = { source, envelope, duckGainLinear: dbToLinear(duckDb) };
    this.jingleElapsedFrames = 0;
  }

  clearJingleSource(): void {
    this.jingleSlot = null;
    this.jingleElapsedFrames = 0;
  }

  get jingleActive(): boolean {
    return this.jingleSlot !== null;
  }

  /** Mounts the live-mic overlay. Unlike the jingle slot, the source is summed at unity gain
   * (already client-side-scaled by the browser's own volume control, see liveMicBroadcast.ts) --
   * what the mixer owns is only the *primary bus's* duck gain, not the mic's own level. */
  setMicSource(source: Source): void {
    this.micSource = source;
  }

  clearMicSource(): void {
    this.micSource = null;
  }

  get micActive(): boolean {
    return this.micSource !== null;
  }

  /** Updates the duck target the primary bus ramps toward while a mic is live (the manager's
   * "music volume" slider, POST /live-mic/music-volume). Takes effect immediately -- if a mic is
   * already live, the primary bus re-fades toward the new target on the next ticks. */
  setMicDuckTarget(linear: number): void {
    this.micDuckTargetLinear = linear;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startTimeNs = process.hrtime.bigint();
    this.frameCount = 0;
    this.logger.info({ frameMs: FRAME_MS, frameBytes: FRAME_BYTES }, "mixer started");
    this.scheduleNext(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.logger.info({ framesEmitted: this.frameCount, underruns: this.underruns }, "mixer stopped");
  }

  get underrunCount(): number {
    return this.underruns;
  }

  private scheduleNext(delayMs: number): void {
    this.timer = setTimeout(() => this.tick(), Math.max(0, delayMs));
  }

  private tick(): void {
    if (!this.running) return;

    const primaryFrame = this.primarySource.getFrame();
    if (!primaryFrame) this.underruns += 1;
    const primarySamples = primaryFrame ?? ZERO_SAMPLES;

    // Ramp the mic duck gain toward its target every tick -- a continuous fade in both
    // directions (duck in when a mic mounts, fade back to 1.0 once it's cleared), never an
    // instant snap. Runs unconditionally so the fade-out completes even after micSource is
    // already null.
    const duckTarget = this.micSource ? this.micDuckTargetLinear : 1;
    if (this.micDuckGain < duckTarget) {
      this.micDuckGain = Math.min(duckTarget, this.micDuckGain + MIC_DUCK_STEP_PER_FRAME);
    } else if (this.micDuckGain > duckTarget) {
      this.micDuckGain = Math.max(duckTarget, this.micDuckGain - MIC_DUCK_STEP_PER_FRAME);
    }

    let jingleGain = 0;
    let jingleDuckGain = 1;
    let jingleSamples: Float32Array = ZERO_SAMPLES;
    if (this.jingleSlot) {
      const { source, envelope, duckGainLinear } = this.jingleSlot;
      const elapsedMs = this.jingleElapsedFrames * FRAME_MS;
      this.jingleElapsedFrames += 1;
      jingleGain = envelope.gainAt(elapsedMs);
      jingleDuckGain = 1 - (1 - duckGainLinear) * jingleGain;
      jingleSamples = source.getFrame() ?? ZERO_SAMPLES;
    }

    const micSamples: Float32Array = this.micSource ? (this.micSource.getFrame() ?? ZERO_SAMPLES) : ZERO_SAMPLES;
    const primaryGain = this.micDuckGain * jingleDuckGain;
    const hasOverlaySamples = this.jingleSlot !== null || this.micSource !== null;

    if (hasOverlaySamples) {
      // Actually summing >=2 sources this tick -- soft-limit against clipping.
      const mixed = new Float32Array(FRAME_SAMPLES);
      for (let i = 0; i < FRAME_SAMPLES; i++) {
        const sample =
          (primarySamples[i] ?? 0) * primaryGain + (jingleSamples[i] ?? 0) * jingleGain + (micSamples[i] ?? 0);
        mixed[i] = Math.tanh(sample);
      }
      this.fifoWriter.writeFrame(Buffer.from(mixed.buffer, mixed.byteOffset, mixed.byteLength));
    } else if (primaryFrame) {
      if (primaryGain !== 1) {
        // Nothing to sum against right now, but still ramping back up from a duck
        // (mic just went off-air) -- attenuate without tanh, there's nothing to clip.
        const scaled = new Float32Array(FRAME_SAMPLES);
        for (let i = 0; i < FRAME_SAMPLES; i++) {
          scaled[i] = (primaryFrame[i] ?? 0) * primaryGain;
        }
        this.fifoWriter.writeFrame(Buffer.from(scaled.buffer, scaled.byteOffset, scaled.byteLength));
      } else {
        this.fifoWriter.writeFrame(Buffer.from(primaryFrame.buffer, primaryFrame.byteOffset, primaryFrame.byteLength));
      }
    } else {
      // Source has nothing right now (underrun / stub / not-yet-implemented).
      // Write silence so bus timing (and the FIFO's expected byte rate)
      // never stalls even if a source is temporarily starved.
      this.fifoWriter.writeFrame(SILENCE_FRAME);
    }
    this.frameCount += 1;

    // Drift correction: compute when frame N+1 *should* fire relative to our
    // fixed start time, and schedule for exactly that offset from now.
    const idealElapsedNs = BigInt(this.frameCount) * FRAME_MS_NS;
    const actualElapsedNs = process.hrtime.bigint() - this.startTimeNs;
    const driftNs = idealElapsedNs - actualElapsedNs;
    const nextDelayMs = Number(driftNs) / 1_000_000;

    this.scheduleNext(nextDelayMs);
  }
}

// Re-exported for anything that wants to sanity-check frame sizing without
// importing core/types.ts directly.
export { FRAME_SAMPLES, FRAME_BYTES };
