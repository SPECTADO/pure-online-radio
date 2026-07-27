import type { LiveMusicVolumeCommand, LiveStartCommand, LiveStopCommand } from "@spectado/shared-types";
import type { Mixer } from "../core/mixer.js";
import type { StatusPublisher } from "../nats/statusPublisher.js";
import type { LiveMicServer } from "../ws/liveMicServer.js";
import { MicSource } from "../sources/micSource.js";
import type { Logger } from "../util/logger.js";

/**
 * REAL: mounts/unmounts the live-mic overlay `Slot` (core/mixer.ts) driven off NATS commands,
 * and authorizes the corresponding websocket session on `liveMicServer` (see that class's own
 * doc comment for the authorization ordering). `handleSocketClosed` is `liveMicServer`'s callback
 * for an unsolicited disconnect (tab close, network drop) -- it and `handleLiveStop` both route
 * through `finishSession`, guarded exactly like `RelayController.finishRelay`, so a stale/late
 * event after the session already ended is a no-op rather than a double-teardown.
 */
export class LiveMicController {
  private current: { sessionId: string; source: MicSource } | null = null;

  constructor(
    private readonly mixer: Mixer,
    private readonly liveMicServer: LiveMicServer,
    private readonly statusPublisher: StatusPublisher,
    private readonly logger: Logger,
  ) {}

  async handleLiveStart(command: LiveStartCommand): Promise<void> {
    this.teardownCurrent();

    const source = new MicSource(command.sessionId, this.logger);
    source.once("failed", () => this.finishSession(command.sessionId));

    this.current = { sessionId: command.sessionId, source };
    this.mixer.setMicSource(source);
    this.liveMicServer.attachSession(
      command.sessionId,
      source,
      command.token,
      new Date(command.expiresAt).getTime(),
    );

    this.logger.info({ sessionId: command.sessionId }, "live mic overlay mounted");
    this.statusPublisher.publishLiveStarted({ ts: new Date().toISOString(), sessionId: command.sessionId });
  }

  async handleLiveStop(command: LiveStopCommand): Promise<void> {
    this.finishSession(command.sessionId);
  }

  /** liveMicServer's callback for a socket closing without an explicit LiveStopCommand. */
  handleSocketClosed(sessionId: string): void {
    this.finishSession(sessionId);
  }

  handleSetMusicVolume(command: LiveMusicVolumeCommand): void {
    this.mixer.setMicDuckTarget(command.volume);
  }

  private finishSession(sessionId: string): void {
    if (this.current?.sessionId !== sessionId) return;
    this.teardownCurrent();
    this.liveMicServer.detachSession(sessionId);
    this.logger.info({ sessionId }, "live mic overlay unmounted");
    this.statusPublisher.publishLiveEnded({ ts: new Date().toISOString(), sessionId });
  }

  private teardownCurrent(): void {
    if (this.current) {
      this.current.source.removeAllListeners();
      this.current.source.destroy();
      this.mixer.clearMicSource();
      this.current = null;
    }
  }
}
