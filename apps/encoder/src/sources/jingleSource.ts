import type { JinglePlayCommand } from "@spectado/shared-types";
import type { GainEnvelope, Source } from "../core/types.js";
import type { Logger } from "../util/logger.js";

/**
 * STUB - not implemented in this pass.
 *
 * TODO (full design): decode `command.url` (same ffmpeg-to-pipe approach as
 * queueSource) and expose it as an overlay `Slot` (core/types.ts, kind:
 * "jingle") mounted by jingleController on JinglePlayCommand and unmounted on
 * JingleStopCommand or natural end-of-clip. Needs a GainEnvelope built from
 * `command.fadeInMs`/`command.fadeOutMs` for its own fade in/out, AND to
 * simultaneously drive a *ducking* GainEnvelope applied to the primary bus
 * using `command.duckDb` (see core/mixer.ts's future-design comment for how
 * ducking + summing + soft-limit fit together).
 */
export class JingleSource implements Source {
  private warnedOnce = false;

  constructor(
    private readonly command: JinglePlayCommand,
    private readonly logger: Logger,
  ) {}

  /** TODO: return a real fade in/out envelope built from command.fadeInMs/fadeOutMs. */
  buildGainEnvelope(): GainEnvelope | null {
    return null;
  }

  getFrame(): Float32Array | null {
    if (!this.warnedOnce) {
      this.warnedOnce = true;
      this.logger.warn(
        { jingleId: this.command.jingleId, duckDb: this.command.duckDb },
        "JingleSource.getFrame not implemented - TODO: decode command.url and overlay-mix with ducking envelope",
      );
    }
    return null;
  }
}
