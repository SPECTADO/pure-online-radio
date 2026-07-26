import type { RelayCancelCommand, RelayStartCommand, RelayStopCommand } from "@spectado/shared-types";
import type { Logger } from "../util/logger.js";

/**
 * STUB - not implemented in this pass. commandRouter.ts currently just logs
 * and acks every command itself; nothing calls into this controller yet.
 *
 * TODO (full design): on RelayStartCommand, construct a
 * sources/relaySource.ts, switch the mixer's primary source to it (the api
 * already decides *when* to send this command -- immediately for an AT_TIME
 * schedule, or once the current queue item is about to finish for ASAP --
 * see apps/api/src/scheduler/externalStreamScheduler.ts), and hand back to
 * the queue at `endAt` if one was sent (null = no forced end, run until the
 * source itself stops -- e.g. on-demand EOF or a live disconnect -- and
 * publish relay.ended so the api can mark it stopped). Apply
 * RelayStartCommand.onFailure ("retry" | "fallbackToQueue") if the relay
 * can't connect. On RelayStopCommand, end the relay early. On
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
