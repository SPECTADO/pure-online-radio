import type { GainEnvelope, Source } from "../core/types.js";
import { FRAME_MS, FRAME_SAMPLES } from "../core/types.js";

const ZERO_SAMPLES = new Float32Array(FRAME_SAMPLES);

/**
 * A short-lived Source that blends `from` -> `to` using independent gain
 * envelopes for each side (asymmetric on purpose: the outgoing song's own
 * mixOutDurationMs and the incoming song's mixInDurationMs need not match --
 * see resolveMixPoints/QueueController.beginCrossfade). Once the caller's own
 * timer (sized to the longer of the two envelope durations) fires, the mixer
 * should be pointed at `to` directly (Mixer.setPrimarySource) and this
 * instance discarded via destroy() -- mirrors how Mixer.tick already sums a
 * jingle overlay onto the primary bus.
 *
 * `from` can itself be a still-fading TransitionSource (an in-flight
 * crossfade interrupted by another skip before it completed) -- getFrame()
 * treats it as an opaque Source either way, and destroy() cascades into
 * whatever it wraps.
 */
export class TransitionSource implements Source {
  private elapsedFrames = 0;

  constructor(
    private readonly from: Source,
    private readonly to: Source,
    private readonly fromEnvelope: GainEnvelope,
    private readonly toEnvelope: GainEnvelope,
  ) {}

  getFrame(): Float32Array | null {
    const elapsedMs = this.elapsedFrames * FRAME_MS;
    this.elapsedFrames += 1;

    const fromGain = this.fromEnvelope.gainAt(elapsedMs);
    const toGain = this.toEnvelope.gainAt(elapsedMs);

    // A momentarily-underrun side contributes silence rather than stalling
    // the whole blend -- same underrun handling as Mixer.tick's primary+jingle sum.
    const fromSamples = this.from.getFrame() ?? ZERO_SAMPLES;
    const toSamples = this.to.getFrame() ?? ZERO_SAMPLES;

    const mixed = new Float32Array(FRAME_SAMPLES);
    for (let i = 0; i < FRAME_SAMPLES; i++) {
      // Two live sources summed can exceed +/-1.0 -- soft-limit, same tanh
      // curve Mixer.tick uses while a jingle is mixed onto the primary bus.
      mixed[i] = Math.tanh((fromSamples[i] ?? 0) * fromGain + (toSamples[i] ?? 0) * toGain);
    }
    return mixed;
  }

  destroy(): void {
    this.from.destroy?.();
    this.to.destroy?.();
  }
}
