import type { GainEnvelope } from "./types.js";

/** Converts a dB gain (e.g. JinglePlayCommand.duckDb, typically negative) to a linear multiplier. */
export function dbToLinear(db: number): number {
  return 10 ** (db / 20);
}

/**
 * Fade envelope for a jingle overlay clip: ramps 0->1 over `fadeInMs`, holds
 * at 1, ramps back to 0 over the final `fadeOutMs` before `durationMs`. The
 * mixer also uses this same envelope to drive the *ducking* gain applied to
 * the primary bus (full duck exactly when the jingle is fully faded in, full
 * primary volume once the jingle has faded out) -- see core/mixer.ts.
 */
export class JingleGainEnvelope implements GainEnvelope {
  constructor(
    readonly durationMs: number,
    private readonly fadeInMs: number,
    private readonly fadeOutMs: number,
  ) {}

  gainAt(elapsedMs: number): number {
    if (elapsedMs < this.fadeInMs) {
      return this.fadeInMs > 0 ? clamp01(elapsedMs / this.fadeInMs) : 1;
    }
    const fadeOutStart = this.durationMs - this.fadeOutMs;
    if (elapsedMs > fadeOutStart) {
      return this.fadeOutMs > 0 ? clamp01((this.durationMs - elapsedMs) / this.fadeOutMs) : 0;
    }
    return 1;
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
