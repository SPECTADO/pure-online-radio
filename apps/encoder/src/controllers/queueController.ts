import type {
  AdvanceCommand,
  PlaybackMode,
  SetModeCommand,
  TrackDirectiveDTO,
} from "@spectado/shared-types";
import type { Mixer } from "../core/mixer.js";
import type { ApiClient } from "../api/apiClient.js";
import type { StatusPublisher } from "../nats/statusPublisher.js";
import type { Logger } from "../util/logger.js";
import { QueueSource } from "../sources/queueSource.js";
import { SilenceSource } from "../sources/silenceSource.js";

/** If a queue source never emits "ended" (e.g. a hung ffmpeg decode), force an advance shortly after it should have finished. */
const SAFETY_MARGIN_MS = 5000;
/** Retry delay after a transient failure fetching the next directive (distinct from SilenceDirective.retryAfterMs, which is the API's own "queue is genuinely empty" pacing). */
const FETCH_FAILURE_RETRY_MS = 5000;

/**
 * REAL: the primary-slot state machine. Drives the whole "one queue item
 * after another, silence when empty" behavior by calling
 * `apiClient.fetchNextDirective()` -- which atomically dequeues the head of
 * the manual queue server-side -- whenever it decides playback should
 * advance: at boot, when the current track's source signals `"ended"`, on an
 * explicit AdvanceCommand (skip/manual-start), or after a silence
 * directive's `retryAfterMs`.
 *
 * `apiClient.fetchNextDirective()` is only ever called from here -- see
 * apiClient.ts for why a second caller (e.g. a leftover fixed-interval poll)
 * would double-claim/skip queue items.
 */
export class QueueController {
  private currentSource: QueueSource | null = null;
  private currentMediaId: string | null = null;
  private advanceTimer: NodeJS.Timeout | null = null;
  private mode: PlaybackMode = "LIVE";

  constructor(
    private readonly mixer: Mixer,
    private readonly apiClient: ApiClient,
    private readonly statusPublisher: StatusPublisher,
    private readonly logger: Logger,
  ) {}

  /** Kicks off the first advance at boot. */
  start(): void {
    void this.advance("auto");
  }

  async handleAdvance(command: AdvanceCommand): Promise<void> {
    await this.advance(command.reason);
  }

  async handleSetMode(command: SetModeCommand): Promise<void> {
    this.mode = command.mode;
    this.logger.info({ mode: this.mode }, "playback mode changed");
  }

  private async advance(reason: AdvanceCommand["reason"] | "auto"): Promise<void> {
    this.clearAdvanceTimer();
    const previousTrackId = this.currentMediaId;
    this.teardownCurrentSource();

    const directive = await this.apiClient.fetchNextDirective();
    if (!directive) {
      this.mountSilence();
      this.scheduleAdvance(FETCH_FAILURE_RETRY_MS);
      return;
    }

    if (directive.type === "track") {
      this.mountTrack(directive, previousTrackId, reason);
      return;
    }

    if (directive.type === "silence") {
      this.mountSilence();
      this.scheduleAdvance(directive.retryAfterMs);
      return;
    }

    // external_relay: out of scope in this pass (relay feature untouched) --
    // treat like silence with a short retry rather than pretending relay
    // playback exists.
    this.logger.warn({ directive }, "external_relay directive received but relay playback isn't implemented; treating as silence");
    this.mountSilence();
    this.scheduleAdvance(FETCH_FAILURE_RETRY_MS);
  }

  private mountTrack(directive: TrackDirectiveDTO, previousTrackId: string | null, reason: AdvanceCommand["reason"] | "auto"): void {
    const source = new QueueSource(directive, this.logger);
    source.once("ended", () => {
      if (this.currentSource === source) {
        void this.advance("auto");
      }
    });
    this.currentSource = source;
    this.currentMediaId = directive.mediaId;
    this.mixer.setPrimarySource(source, "track");

    const ts = new Date().toISOString();
    this.statusPublisher.publishNowPlaying({
      ts,
      trackId: directive.mediaId,
      isLive: true,
      type: directive.mediaKind === "JINGLE" ? "jingle" : "track",
      title: directive.title,
      artist: directive.artist,
      album: null,
      coverArtUrl: directive.coverArtUrl,
      startedAt: ts,
      durationMs: directive.durationMs,
      mode: this.mode,
    });
    this.statusPublisher.publishQueueAdvanced({
      ts,
      previousTrackId,
      currentTrackId: directive.mediaId,
      reason,
    });

    this.scheduleAdvance(directive.durationMs + SAFETY_MARGIN_MS);
  }

  private mountSilence(): void {
    this.currentMediaId = null;
    this.mixer.setPrimarySource(new SilenceSource(), "none");

    this.statusPublisher.publishNowPlaying({
      ts: new Date().toISOString(),
      trackId: null,
      isLive: false,
      type: "silence",
      title: null,
      artist: null,
      album: null,
      coverArtUrl: null,
      startedAt: null,
      durationMs: null,
      mode: this.mode,
    });
  }

  private teardownCurrentSource(): void {
    if (this.currentSource) {
      this.currentSource.removeAllListeners("ended");
      this.currentSource.destroy();
      this.currentSource = null;
    }
  }

  private scheduleAdvance(delayMs: number): void {
    this.clearAdvanceTimer();
    this.advanceTimer = setTimeout(() => void this.advance("auto"), delayMs);
  }

  private clearAdvanceTimer(): void {
    if (this.advanceTimer) {
      clearTimeout(this.advanceTimer);
      this.advanceTimer = null;
    }
  }
}
