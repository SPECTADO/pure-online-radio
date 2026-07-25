import type { Source } from "../core/types.js";
import { FRAME_SAMPLES } from "../core/types.js";

/**
 * REAL: the encoder's "offair" state -- mounted as the primary source whenever
 * the queue is empty. Returns an actual zero-filled frame every call rather
 * than `null`: `null` means "underrun" to the mixer (bumps
 * `Mixer.underrunCount`, which feeds the heartbeat's health signal), and
 * deliberate silence is not an underrun.
 */
export class SilenceSource implements Source {
  getFrame(): Float32Array {
    return new Float32Array(FRAME_SAMPLES);
  }
}
