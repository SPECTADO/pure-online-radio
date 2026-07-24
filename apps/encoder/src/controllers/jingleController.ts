import type { JinglePlayCommand, JingleStopCommand } from "@spectado/shared-types";
import type { Logger } from "../util/logger.js";

/**
 * STUB - not implemented in this pass. commandRouter.ts currently just logs
 * and acks every command itself; nothing calls into this controller yet.
 *
 * TODO (full design): on JinglePlayCommand, construct a sources/jingleSource.ts
 * from the command, mount it as the "jingle" overlay Slot (core/types.ts),
 * apply its ducking GainEnvelope to the primary bus, and publish
 * jingleStarted/jingleEnded status as it plays/finishes. On
 * JingleStopCommand, tear the overlay down early (with a fast fade-out
 * rather than a hard cut).
 */
export class JingleController {
  constructor(private readonly logger: Logger) {}

  async handleJinglePlay(command: JinglePlayCommand): Promise<void> {
    this.logger.warn({ command }, "JingleController.handleJinglePlay not implemented - TODO: mount jingle overlay with ducking envelope");
  }

  async handleJingleStop(command: JingleStopCommand): Promise<void> {
    this.logger.warn({ command }, "JingleController.handleJingleStop not implemented - TODO: fade out and unmount jingle overlay");
  }
}
