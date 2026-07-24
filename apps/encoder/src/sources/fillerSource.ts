import type { Source } from "../core/types.js";
import { SAMPLE_RATE_HZ, SAMPLES_PER_CHANNEL_PER_FRAME, FRAME_SAMPLES } from "../core/types.js";

const TONE_HZ = 440;
/** -14 dBFS-ish linear amplitude - audible but not ear-splitting; a real smoke-test tone. */
const AMPLITUDE = 0.2;
const TWO_PI = 2 * Math.PI;
const PHASE_INCREMENT = (TWO_PI * TONE_HZ) / SAMPLE_RATE_HZ;

/**
 * REAL (not a stub): always-on filler audio, a continuous 440Hz sine tone.
 *
 * This is the one source actually wired into the mixer for this pass. It
 * exists so `docker compose up` produces an audible, verifiable HLS stream
 * even before queue playback exists. Phase is tracked continuously across
 * calls (never reset per-frame) so there is no discontinuity/click at frame
 * boundaries - only at process restart, which is inaudible in practice.
 */
export class FillerSource implements Source {
  private phase = 0;

  getFrame(): Float32Array {
    const frame = new Float32Array(FRAME_SAMPLES);
    for (let i = 0; i < SAMPLES_PER_CHANNEL_PER_FRAME; i++) {
      const sample = Math.sin(this.phase) * AMPLITUDE;
      frame[i * 2] = sample; // left
      frame[i * 2 + 1] = sample; // right
      this.phase += PHASE_INCREMENT;
      if (this.phase >= TWO_PI) {
        this.phase -= TWO_PI;
      }
    }
    return frame;
  }
}
