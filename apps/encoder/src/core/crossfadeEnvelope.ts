import type { GainEnvelope } from "./types.js";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Equal-power fade curves for TransitionSource: gain follows cos/sin rather
 * than a straight ramp so the *perceived* loudness of the two blended sources
 * stays roughly constant through the crossfade (a linear ramp momentarily
 * dips the combined loudness in the middle of the blend, since power falls
 * off faster than amplitude).
 */
export class EqualPowerFadeOutEnvelope implements GainEnvelope {
  constructor(readonly durationMs: number) {}

  gainAt(elapsedMs: number): number {
    if (this.durationMs <= 0) return 0;
    const t = clamp01(elapsedMs / this.durationMs);
    return Math.cos(t * (Math.PI / 2));
  }
}

export class EqualPowerFadeInEnvelope implements GainEnvelope {
  constructor(readonly durationMs: number) {}

  gainAt(elapsedMs: number): number {
    if (this.durationMs <= 0) return 1;
    const t = clamp01(elapsedMs / this.durationMs);
    return Math.sin(t * (Math.PI / 2));
  }
}
