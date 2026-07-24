import type { LiveStartCommand, LiveStopCommand } from "@spectado/shared-types";
import type { Logger } from "../util/logger.js";

/**
 * STUB - not implemented in this pass. commandRouter.ts currently just logs
 * and acks every command itself; nothing calls into this controller yet.
 *
 * TODO (full design): on LiveStartCommand, validate `token`/`expiresAt`,
 * correlate to the websocket session opened against ws/liveMicServer.ts by
 * `sessionId`, construct a sources/micSource.ts, mount it as the "mic"
 * overlay Slot with its own ducking envelope, and publish liveStarted
 * status. On LiveStopCommand (or socket close/expiry), unmount and publish
 * liveEnded.
 */
export class LiveMicController {
  constructor(private readonly logger: Logger) {}

  async handleLiveStart(command: LiveStartCommand): Promise<void> {
    this.logger.warn({ command }, "LiveMicController.handleLiveStart not implemented - TODO: correlate websocket session and mount mic overlay");
  }

  async handleLiveStop(command: LiveStopCommand): Promise<void> {
    this.logger.warn({ command }, "LiveMicController.handleLiveStop not implemented - TODO: unmount mic overlay");
  }
}
