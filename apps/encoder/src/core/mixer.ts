import type { FifoWriter } from "./fifoWriter.js";
import type { Logger } from "../util/logger.js";
import type { Source } from "./types.js";
import { FRAME_MS, FRAME_SAMPLES, FRAME_BYTES } from "./types.js";

const FRAME_MS_NS = BigInt(FRAME_MS) * 1_000_000n;
const SILENCE_FRAME = Buffer.alloc(FRAME_BYTES); // all-zero f32le frame

/**
 * FUTURE DESIGN (not implemented in this pass - see below for what IS real):
 *
 * The full mixer is a small real-time audio graph, ticked once per 20ms
 * frame:
 *
 *   primary bus (queueSource | relaySource | filler, exactly one active,
 *                with transitionSource crossfading between two of them
 *                across a handoff window)
 *     -> duck when jingle or mic overlay is active (gain envelope pulls the
 *        primary bus down by JinglePlayCommand.duckDb, ramped over
 *        fadeInMs/fadeOutMs via a GainEnvelope, see core/types.ts)
 *     -> sum with jingle overlay (0 or 1 active jingleSource, own
 *        GainEnvelope for its fade in/out)
 *     -> sum with mic overlay (0 or 1 active micSource, decoded from the
 *        live-mic websocket, own ducking envelope)
 *     -> soft-limit the summed signal (e.g. tanh or a lookahead limiter) to
 *        avoid clipping when multiple sources sum above +/-1.0
 *     -> written to the FIFO as one 20ms frame
 *
 * Sources would be mounted/unmounted as `Slot`s (core/types.ts) by
 * queueController/jingleController/liveMicController driven off NATS
 * commands, instead of the single hardcoded FillerSource below.
 *
 * WHAT'S REAL IN THIS PASS:
 *
 * Only the primary slot is wired up, and it is hardcoded to a single
 * FillerSource - no ducking, no summing, no limiting, because there is
 * nothing else to mix yet. What IS fully real is the timing: a
 * drift-corrected 20ms tick loop. setTimeout is not exact (OS scheduling,
 * event loop jitter), so naively calling `setTimeout(tick, 20)` recursively
 * accumulates drift - after a few minutes the wall-clock output would fall
 * measurably behind or ahead of 20ms/frame. Instead we track how many frames
 * we've *intended* to emit since start, compare that to actual elapsed
 * hi-res time, and shrink/grow the next timer delay to correct the
 * difference, so average frame cadence converges on exactly 20ms even though
 * any single tick may fire a little early or late.
 */
export class Mixer {
  private primarySource: Source;
  private timer: NodeJS.Timeout | null = null;
  private startTimeNs = 0n;
  private frameCount = 0;
  private underruns = 0;
  private running = false;

  constructor(
    initialPrimarySource: Source,
    private readonly fifoWriter: FifoWriter,
    private readonly logger: Logger,
  ) {
    this.primarySource = initialPrimarySource;
  }

  /**
   * Swaps the active primary source (e.g. filler -> queue track). Not called
   * by anything yet in this pass since queueController is a stub, but this
   * is the seam controllers will use once real playback lands.
   */
  setPrimarySource(source: Source): void {
    this.primarySource = source;
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

    const frame = this.primarySource.getFrame();
    if (frame) {
      this.fifoWriter.writeFrame(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength));
    } else {
      // Source has nothing right now (underrun / stub / not-yet-implemented).
      // Write silence so bus timing (and the FIFO's expected byte rate)
      // never stalls even if a source is temporarily starved.
      this.underruns += 1;
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
