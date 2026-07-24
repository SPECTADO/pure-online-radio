import type { ExternalRelayDirectiveDTO } from "@spectado/shared-types";
import type { Source } from "../core/types.js";
import type { Logger } from "../util/logger.js";

/**
 * STUB - not implemented in this pass.
 *
 * TODO (full design): spawn `ffmpeg -i <directive.url> -f f32le -ar 48000
 * -ac 2 pipe:1` against the external relay stream url and decode it the same
 * way queueSource will, but with reconnect/backoff handling for a flaky
 * upstream (see process/processSupervisor.ts, reused here) and a hard
 * fallback to the queue if the relay can't be (re)established before
 * `directive.until` per RelayStartCommand.onFailure. Should emit
 * relay.started/relay.ended status via statusPublisher through
 * relayController.
 */
export class RelaySource implements Source {
  private warnedOnce = false;

  constructor(
    private readonly directive: ExternalRelayDirectiveDTO,
    private readonly logger: Logger,
  ) {}

  getFrame(): Float32Array | null {
    if (!this.warnedOnce) {
      this.warnedOnce = true;
      this.logger.warn(
        { relayId: this.directive.relayId, url: this.directive.url },
        "RelaySource.getFrame not implemented - TODO: decode external relay url via ffmpeg with reconnect/backoff",
      );
    }
    return null;
  }
}
