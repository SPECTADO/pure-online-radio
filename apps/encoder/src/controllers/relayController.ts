import type { RelayCancelCommand, RelayStartCommand, RelayStopCommand } from "@spectado/shared-types";
import type { Logger } from "../util/logger.js";

/**
 * STUB - not implemented in this pass. commandRouter.ts currently just logs
 * and acks every command itself; nothing calls into this controller yet.
 *
 * TODO (full design): on RelayStartCommand, construct a
 * sources/relaySource.ts, schedule it to become the primary source at
 * `startAt` (via TransitionSource) and to hand back to the queue at
 * `endAt`; apply RelayStartCommand.onFailure ("retry" | "fallbackToQueue")
 * if the relay can't connect. On RelayStopCommand, end the relay early. On
 * RelayCancelCommand, cancel a not-yet-started scheduled relay outright.
 */
export class RelayController {
  constructor(private readonly logger: Logger) {}

  async handleRelayStart(command: RelayStartCommand): Promise<void> {
    this.logger.warn({ command }, "RelayController.handleRelayStart not implemented - TODO: schedule relay source as primary between startAt/endAt");
  }

  async handleRelayStop(command: RelayStopCommand): Promise<void> {
    this.logger.warn({ command }, "RelayController.handleRelayStop not implemented - TODO: end relay early and hand back to queue");
  }

  async handleRelayCancel(command: RelayCancelCommand): Promise<void> {
    this.logger.warn({ command }, "RelayController.handleRelayCancel not implemented - TODO: cancel a not-yet-started scheduled relay");
  }
}
