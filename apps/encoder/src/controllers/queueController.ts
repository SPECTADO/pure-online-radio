import type { AdvanceCommand, SetModeCommand } from "@spectado/shared-types";
import type { Mixer } from "../core/mixer.js";
import type { ApiClient } from "../api/apiClient.js";
import type { Logger } from "../util/logger.js";

/**
 * STUB - not implemented in this pass. commandRouter.ts currently just logs
 * and acks every command itself; nothing calls into this controller yet.
 *
 * TODO (full design): the primary-slot state machine. On AdvanceCommand,
 * call apiClient.fetchNextDirective(), build a QueueSource/RelaySource/
 * FillerSource depending on the PlaybackDirectiveDTO's discriminant, hand
 * off via TransitionSource, then mixer.setPrimarySource() to the new one
 * once the crossfade completes; publish QueueAdvancedStatus/NowPlayingStatus
 * along the way. On SetModeCommand, switch between LIVE (auto-advance off
 * queue) and MANUAL (hold until an explicit AdvanceCommand) scheduling.
 */
export class QueueController {
  constructor(
    private readonly mixer: Mixer,
    private readonly apiClient: ApiClient,
    private readonly logger: Logger,
  ) {}

  async handleAdvance(command: AdvanceCommand): Promise<void> {
    this.logger.warn({ command }, "QueueController.handleAdvance not implemented - TODO: resolve next directive and hand off primary source");
  }

  async handleSetMode(command: SetModeCommand): Promise<void> {
    this.logger.warn({ command }, "QueueController.handleSetMode not implemented - TODO: switch LIVE/MANUAL scheduling behavior");
  }
}
