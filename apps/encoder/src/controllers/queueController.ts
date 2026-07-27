import type {
  AdvanceCommand,
  NowPlayingStatus,
  PlaybackMode,
  SetModeCommand,
  TrackDirectiveDTO,
} from "@spectado/shared-types";
import type { Mixer } from "../core/mixer.js";
import type { Source } from "../core/types.js";
import { EqualPowerFadeInEnvelope, EqualPowerFadeOutEnvelope } from "../core/crossfadeEnvelope.js";
import type { ApiClient } from "../api/apiClient.js";
import type { StatusPublisher } from "../nats/statusPublisher.js";
import type { Logger } from "../util/logger.js";
import { QueueSource } from "../sources/queueSource.js";
import { SilenceSource } from "../sources/silenceSource.js";
import { TransitionSource } from "../sources/transitionSource.js";

/** If a queue source never emits "ended" (e.g. a hung ffmpeg decode), force an advance shortly after it should have finished. Only ever the backstop for non-song primary items -- see activateTrack. */
const SAFETY_MARGIN_MS = 5000;
/** Retry delay after a transient failure fetching the next directive (distinct from SilenceDirective.retryAfterMs, which is the API's own "queue is genuinely empty" pacing). */
const FETCH_FAILURE_RETRY_MS = 5000;

type SongDirective = TrackDirectiveDTO & {
  mixInPointMs: number;
  mixInDurationMs: number;
  mixOutPointMs: number;
  mixOutDurationMs: number;
};

/** Only SONG-to-SONG transitions crossfade (see beginCrossfade) -- the API
 * only ever resolves mix points for songs, leaving them null for jingles/ads. */
function isSongDirective(directive: TrackDirectiveDTO): directive is SongDirective {
  return directive.mediaKind === "SONG" && directive.mixInPointMs !== null;
}

interface PendingTransition {
  transitionSource: TransitionSource;
  /** The Source to destroy() once this transition completes -- may itself be
   * a still-fading TransitionSource from an interrupted earlier crossfade. */
  outgoingToDestroy: Source;
  completeTimer: NodeJS.Timeout;
}

/**
 * REAL: the primary-slot state machine. Drives the whole "one queue item
 * after another, silence when empty" behavior by calling
 * `apiClient.fetchNextDirective()` -- which atomically dequeues the head of
 * the manual queue server-side -- whenever it decides playback should
 * advance: at boot, when the current track's source signals `"ended"`, on an
 * explicit AdvanceCommand (skip/manual-start/scheduled), or after a silence
 * directive's `retryAfterMs`.
 *
 * `apiClient.fetchNextDirective()` is only ever called from here -- see
 * apiClient.ts for why a second caller (e.g. a leftover fixed-interval poll)
 * would double-claim/skip queue items.
 *
 * Song-to-song crossfading: `beginCrossfade` is the single entry point for
 * every one of the triggers above. For two consecutive SONG items it fetches
 * the next directive *before* the current one ends (proactively, at the
 * current song's resolved mixOutPointMs) and blends the two via
 * TransitionSource instead of the hard cut used for every other transition
 * (jingle/ad primary items, silence, relay). An explicit skip goes through
 * the exact same path, just triggered immediately instead of at the natural
 * mix-out point -- see the class-level comment on beginCrossfade below.
 */
export class QueueController {
  /** The track currently considered "now playing" and its raw decode source
   * (never a transition wrapper) -- what the *next* crossfade fades out of,
   * and what the mixer's primary becomes once an in-flight transition completes. */
  private activeSource: QueueSource | null = null;
  private activeDirective: TrackDirectiveDTO | null = null;
  /** Set only while the mixer's primary is actually a blended TransitionSource. */
  private pendingTransition: PendingTransition | null = null;
  private advanceTimer: NodeJS.Timeout | null = null;
  private mode: PlaybackMode = "LIVE";
  private lastNowPlaying: NowPlayingStatus | null = null;

  constructor(
    private readonly mixer: Mixer,
    private readonly apiClient: ApiClient,
    private readonly statusPublisher: StatusPublisher,
    private readonly logger: Logger,
  ) {}

  /** Kicks off the first advance at boot. */
  start(): void {
    void this.beginCrossfade("auto");
  }

  async handleAdvance(command: AdvanceCommand): Promise<void> {
    await this.beginCrossfade(command.reason);
  }

  /** Current playback mode -- read by RelayController to fill NowPlayingStatus.mode when mounting a relay. */
  get currentMode(): PlaybackMode {
    return this.mode;
  }

  /**
   * Called by RelayController right before it takes over the mixer's primary
   * slot for a relay: stops this controller's own advance-timer/current-
   * source bookkeeping from fighting over ownership of the bus while the
   * relay is live. Does not touch the mixer itself -- RelayController does
   * that immediately after.
   */
  suspendForRelay(): void {
    this.teardownActivePlayback();
  }

  /**
   * Called by RelayController once the relay has ended/stopped/failed --
   * resumes normal queue-driven playback from wherever it left off, same as
   * any other "auto" advance.
   */
  resumeAfterRelay(): void {
    void this.beginCrossfade("auto");
  }

  async handleSetMode(command: SetModeCommand): Promise<void> {
    const previousMode = this.mode;
    this.mode = command.mode;
    this.logger.info({ mode: this.mode }, "playback mode changed");

    // Switching into AUTO while sitting on manual-mode silence resumes
    // playback immediately rather than waiting for an explicit skip.
    if (previousMode === "MANUAL" && this.mode === "LIVE" && !this.activeSource) {
      void this.beginCrossfade("auto");
      return;
    }

    // No advance triggered above -- the dashboard's AUTO/MANUAL pill has
    // nothing else to react to until the next real now-playing event (which
    // might be minutes away, or never if nothing is currently playing), so
    // push the mode change to clients immediately.
    if (this.lastNowPlaying) {
      this.publishStatus({ ...this.lastNowPlaying, mode: this.mode, ts: new Date().toISOString() });
    }
  }

  /**
   * Single entry point for every forward move: boot, a source's natural
   * "ended", the proactive crossfade-trigger timer scheduled at a song's own
   * mixOutPointMs, and every explicit AdvanceCommand. An explicit skip isn't
   * special-cased into a hard cut: it just calls this early (before the
   * scheduled trigger would have), so it crossfades exactly like a natural
   * transition instead of clicking straight to the next track.
   */
  private async beginCrossfade(reason: AdvanceCommand["reason"] | "auto"): Promise<void> {
    this.clearAdvanceTimer();

    const outgoingDirective = this.activeDirective;
    const previousTrackId = outgoingDirective?.mediaId ?? null;

    // If a transition is already blending, its own blend becomes the
    // "outgoing" side below instead of being torn down -- a second skip (or
    // an unlucky auto-trigger race) mid-fade keeps fading out of whatever's
    // actually audible right now rather than cutting it off hard. destroy()
    // on the eventual replacement transition cascades into this one, so
    // nothing here leaks the ffmpeg processes underneath.
    let outgoingSource: Source | null = this.activeSource;
    if (this.pendingTransition) {
      clearTimeout(this.pendingTransition.completeTimer);
      outgoingSource = this.pendingTransition.transitionSource;
      this.pendingTransition = null;
    }

    // MANUAL mode: only an explicit AdvanceCommand (skip) moves playback
    // forward. An "auto" trigger (track ended, boot, silence retry, a
    // song's own crossfade-trigger) just holds silence until the user clicks
    // Skip -- and mustn't call fetchNextDirective, which has the side effect
    // of dequeuing the head of the queue, since nothing is going to play it.
    if (reason === "auto" && this.mode === "MANUAL") {
      this.hardCutToSilence(outgoingSource);
      return;
    }

    const directive = await this.apiClient.fetchNextDirective();

    if (!directive) {
      this.hardCutToSilence(outgoingSource);
      this.scheduleAdvance(FETCH_FAILURE_RETRY_MS);
      return;
    }

    if (directive.type === "silence") {
      this.hardCutToSilence(outgoingSource);
      this.scheduleAdvance(directive.retryAfterMs);
      return;
    }

    if (directive.type === "external_relay") {
      // Out of scope in this pass (relay feature untouched) -- treat like
      // silence with a short retry rather than pretending relay playback exists.
      this.logger.warn({ directive }, "external_relay directive received but relay playback isn't implemented; treating as silence");
      this.hardCutToSilence(outgoingSource);
      this.scheduleAdvance(FETCH_FAILURE_RETRY_MS);
      return;
    }

    if (outgoingSource && outgoingDirective && isSongDirective(outgoingDirective) && isSongDirective(directive)) {
      this.beginTrackCrossfade(outgoingSource, outgoingDirective, directive, previousTrackId, reason);
      return;
    }

    // Hard cut: either side isn't a song (jingle/ad primary item, or nothing
    // was playing before -- boot/after silence/after a relay), or the
    // previous track already finished naturally with nothing queued behind it.
    outgoingSource?.destroy?.();
    const startOffsetMs = isSongDirective(directive) ? directive.mixInPointMs : 0;
    const source = new QueueSource(directive, this.logger, startOffsetMs);
    this.mixer.setPrimarySource(source, "track");
    this.activateTrack(source, directive, previousTrackId, reason);
  }

  private beginTrackCrossfade(
    outgoingSource: Source,
    outgoingDirective: SongDirective,
    incomingDirective: SongDirective,
    previousTrackId: string | null,
    reason: AdvanceCommand["reason"] | "auto",
  ): void {
    const incomingSource = new QueueSource(incomingDirective, this.logger, incomingDirective.mixInPointMs);
    const transitionSource = new TransitionSource(
      outgoingSource,
      incomingSource,
      new EqualPowerFadeOutEnvelope(outgoingDirective.mixOutDurationMs),
      new EqualPowerFadeInEnvelope(incomingDirective.mixInDurationMs),
    );
    this.mixer.setPrimarySource(transitionSource, "track");

    const transitionDurationMs = Math.max(outgoingDirective.mixOutDurationMs, incomingDirective.mixInDurationMs);
    const completeTimer = setTimeout(
      () => this.completeCrossfade(transitionSource, incomingSource),
      transitionDurationMs,
    );
    this.pendingTransition = { transitionSource, outgoingToDestroy: outgoingSource, completeTimer };

    // The incoming song is "now playing" from the moment it starts fading
    // in, same as any other mount -- no separate "crossfading" status.
    this.activateTrack(incomingSource, incomingDirective, previousTrackId, reason);
  }

  /** Fires once a crossfade's transition window elapses: swap the mixer
   * straight onto the plain incoming source and release the outgoing chain. */
  private completeCrossfade(transitionSource: TransitionSource, incomingSource: QueueSource): void {
    // Already superseded by a later beginCrossfade (which clears
    // pendingTransition and this timer) -- guard in case both still fire in
    // the same tick.
    if (this.pendingTransition?.transitionSource !== transitionSource) return;

    const { outgoingToDestroy } = this.pendingTransition;
    this.pendingTransition = null;
    this.mixer.setPrimarySource(incomingSource, "track");
    outgoingToDestroy.destroy?.();
  }

  /** Marks `source`/`directive` as the active track, publishes now-playing,
   * and schedules whatever comes next -- a song's proactive crossfade
   * trigger, or the old fixed safety-margin advance for everything else. */
  private activateTrack(
    source: QueueSource,
    directive: TrackDirectiveDTO,
    previousTrackId: string | null,
    reason: AdvanceCommand["reason"] | "auto",
  ): void {
    this.activeSource = source;
    this.activeDirective = directive;
    source.once("ended", () => {
      if (this.activeSource === source) void this.beginCrossfade("auto");
    });

    const ts = new Date().toISOString();
    this.publishStatus({
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

    if (isSongDirective(directive)) {
      // Proactively re-enters beginCrossfade well before this song's natural
      // end, so the next song has time to fade in underneath it. A plain
      // setTimeout, not dependent on ffmpeg emitting anything -- this
      // replaces the old fixed SAFETY_MARGIN_MS timer for songs entirely,
      // since it's already immune to the hung-decode case that timer guarded
      // against.
      this.scheduleAdvance(Math.max(0, directive.mixOutPointMs - directive.mixInPointMs));
    } else {
      // Non-song primary items (jingle/ad) are unchanged: driven by their
      // own "ended" event above, with this fixed margin only as a
      // hung-decode backstop.
      this.scheduleAdvance(directive.durationMs + SAFETY_MARGIN_MS);
    }
  }

  private hardCutToSilence(outgoingSource: Source | null): void {
    outgoingSource?.destroy?.();
    this.activeSource = null;
    this.activeDirective = null;
    this.mixer.setPrimarySource(new SilenceSource(), "none");

    this.publishStatus({
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

  private publishStatus(status: NowPlayingStatus): void {
    this.lastNowPlaying = status;
    this.statusPublisher.publishNowPlaying(status);
  }

  private teardownActivePlayback(): void {
    this.clearAdvanceTimer();
    if (this.pendingTransition) {
      clearTimeout(this.pendingTransition.completeTimer);
      this.pendingTransition.transitionSource.destroy();
      this.pendingTransition = null;
    }
    if (this.activeSource) {
      this.activeSource.removeAllListeners("ended");
      this.activeSource.destroy();
      this.activeSource = null;
    }
    this.activeDirective = null;
  }

  private scheduleAdvance(delayMs: number): void {
    this.clearAdvanceTimer();
    this.advanceTimer = setTimeout(() => void this.beginCrossfade("auto"), delayMs);
  }

  private clearAdvanceTimer(): void {
    if (this.advanceTimer) {
      clearTimeout(this.advanceTimer);
      this.advanceTimer = null;
    }
  }
}
