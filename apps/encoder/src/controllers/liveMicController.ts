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
 * event after the session already ended is a no-op rather than a double-teardown. Ending a
 * session revokes its socket and publishes liveEnded immediately, but leaves the source mounted
 * until its jitter buffer has played out (`MicSource.drain`), so the last words aren't cut off.
 * A session whose browser never connects is ended after CONNECT_TIMEOUT_MS.
 */
/** How long a session may stay mounted (music ducked) without its browser ever connecting. Covers
 * the api's POST -> getUserMedia (incl. a first-time permission prompt) -> websocket connect. */
const CONNECT_TIMEOUT_MS = 60_000;

export class LiveMicController {
  private current: { sessionId: string; source: MicSource; connectTimer: NodeJS.Timeout } | null = null;
  /** An ended session's source still playing out its jitter buffer (see MicSource.drain). */
  private draining: MicSource | null = null;

  constructor(
    private readonly mixer: Mixer,
    private readonly liveMicServer: LiveMicServer,
    private readonly statusPublisher: StatusPublisher,
    private readonly logger: Logger,
  ) {}

  async handleLiveStart(command: LiveStartCommand): Promise<void> {
    // A full finish (not just teardownCurrent): the replaced session's socket must be revoked
    // and closed too, and its liveEnded published, or it would linger authorized.
    if (this.current) this.finishSession(this.current.sessionId);
    // A new broadcast takes the mic slot over immediately (setMicSource below replaces it).
    this.discardDraining();

    const source = new MicSource(command.sessionId, this.logger);
    source.once("failed", () => this.finishSession(command.sessionId));

    const connectTimer = setTimeout(() => {
      if (this.current?.sessionId !== command.sessionId || this.liveMicServer.hasConnected(command.sessionId)) return;
      this.logger.warn({ sessionId: command.sessionId }, "live mic session never connected; ending it");
      this.finishSession(command.sessionId);
    }, CONNECT_TIMEOUT_MS);
    this.current = { sessionId: command.sessionId, source, connectTimer };
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
    const { source, connectTimer } = this.current;
    this.current = null;
    clearTimeout(connectTimer);
    source.removeAllListeners();
    this.liveMicServer.detachSession(sessionId);

    // Stays mounted (music still ducked) until its buffered audio has played out, then unmounts.
    this.discardDraining();
    this.draining = source;
    source.drain(() => {
      if (this.draining === source) {
        this.draining = null;
        this.mixer.clearMicSource();
        this.logger.info({ sessionId }, "live mic overlay unmounted");
      }
      source.destroy();
    });

    this.logger.info({ sessionId }, "live mic session ended; draining buffered audio");
    this.statusPublisher.publishLiveEnded({ ts: new Date().toISOString(), sessionId });
  }

  private discardDraining(): void {
    if (!this.draining) return;
    this.draining.destroy();
    this.draining = null;
  }
}
