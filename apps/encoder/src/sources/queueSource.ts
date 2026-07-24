import type { TrackDirectiveDTO } from "@spectado/shared-types";
import type { Source } from "../core/types.js";
import type { Logger } from "../util/logger.js";

/**
 * STUB - not implemented in this pass.
 *
 * TODO (full design): spawn `ffmpeg -i <directive.url> -f f32le -ar 48000
 * -ac 2 pipe:1` (the url is a short-lived presigned MinIO GET url from
 * TrackDirectiveDTO), stream stdout through core/pcmFraming.ts into a
 * core/ringBuffer.ts sized a few hundred ms deep so decode I/O jitter never
 * stalls the mixer tick, and hand frames back via getFrame(). Track playback
 * position against `directive.durationMs` and signal completion (e.g. via a
 * callback or an EventEmitter) so queueController can advance to the next
 * PlaybackDirectiveDTO and hand off through transitionSource for a
 * crossfade. Must also handle mid-track cancellation (AdvanceCommand with
 * reason "skip") by tearing down the ffmpeg child cleanly.
 */
export class QueueSource implements Source {
  private warnedOnce = false;

  constructor(
    private readonly directive: TrackDirectiveDTO,
    private readonly logger: Logger,
  ) {}

  getFrame(): Float32Array | null {
    if (!this.warnedOnce) {
      this.warnedOnce = true;
      this.logger.warn(
        { mediaId: this.directive.mediaId, title: this.directive.title },
        "QueueSource.getFrame not implemented - TODO: decode directive.url via ffmpeg into a ring buffer",
      );
    }
    return null;
  }
}
