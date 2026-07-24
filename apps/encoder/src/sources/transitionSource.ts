import type { Source } from "../core/types.js";
import type { Logger } from "../util/logger.js";

/**
 * STUB - not implemented in this pass.
 *
 * TODO (full design): a short-lived Source that linearly crossfades `from`
 * -> `to` over `durationMs` (equal-power or linear gain ramp - TBD), used by
 * queueController to hand off between two QueueSource/RelaySource/
 * FillerSource instances without a click or dead air. Once past
 * `durationMs` the mixer should be pointed at `to` directly (see
 * Mixer.setPrimarySource) and this instance discarded.
 */
export class TransitionSource implements Source {
  private warnedOnce = false;

  constructor(
    private readonly from: Source,
    private readonly to: Source,
    private readonly durationMs: number,
    private readonly logger: Logger,
  ) {}

  getFrame(): Float32Array | null {
    if (!this.warnedOnce) {
      this.warnedOnce = true;
      this.logger.warn(
        { durationMs: this.durationMs },
        "TransitionSource.getFrame not implemented - TODO: crossfade from -> to over durationMs",
      );
    }
    return null;
  }
}
