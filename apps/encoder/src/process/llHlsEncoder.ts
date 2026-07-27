import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { StreamSettingsDTO } from "@spectado/shared-types";
import type { EncoderConfig } from "../config.js";
import type { Logger } from "../util/logger.js";
import { FfmpegProcess } from "./ffmpegProcess.js";

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;
const HEALTHY_UPTIME_MS = 10_000;

const LOW_FIFO_NAME = "ll_low.fifo";
const HIGH_FIFO_NAME = "ll_high.fifo";

// LL-HLS "part" duration, derived from the user's segment length rather than
// separately exposed as its own setting -- clamped so an extreme segment
// length (1s or 30s) still produces a sane part size. Matches the ratio
// (~1/10th of the segment) verified during the feasibility spike.
function partSecondsFor(segmentSeconds: number): number {
  return Math.min(1, Math.max(0.1, segmentSeconds / 10));
}

/**
 * Builds argv for the ffmpeg process that does ENCODING ONLY (no HLS
 * muxing) for low-latency mode: reads the master PCM FIFO, asplits into two
 * variants, and writes each as ADTS AAC into its own FIFO for gpac (below)
 * to consume. `-y` is required even with `-nostdin` -- ffmpeg's
 * "output already exists, overwrite?" check fires against a pre-created
 * FIFO path just like it would a real file (verified during the
 * feasibility spike; without it ffmpeg silently refuses to open the pipe).
 */
export function buildLlEncodeArgs(config: EncoderConfig, stream: StreamSettingsDTO, lowFifoPath: string, highFifoPath: string): string[] {
  return [
    "-nostdin",
    "-y",
    "-hide_banner",
    "-loglevel",
    "warning",

    "-f",
    "f32le",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-i",
    config.pcmFifoPath,

    "-filter_complex",
    "asplit=2[low_in][high_in]",

    "-map",
    "[low_in]",
    "-c:a",
    "aac",
    "-b:a",
    `${stream.lowBitrateKbps}k`,
    "-ar",
    "44100",
    "-ac",
    "1",
    "-f",
    "adts",
    lowFifoPath,

    "-map",
    "[high_in]",
    "-c:a",
    "aac",
    "-b:a",
    `${stream.highBitrateKbps}k`,
    "-ar",
    "48000",
    "-ac",
    "2",
    "-f",
    "adts",
    highFifoPath,
  ];
}

/**
 * Builds argv for the `gpac` dasher: one process, two `-i` sources (one per
 * bitrate variant, each tagged with its own #Bandwidth/#HLSPL so gpac
 * generates the master playlist plus both variant playlists+segments in a
 * single pass), `llhls=br` for real byte-range EXT-X-PART/PRELOAD-HINT
 * parts. tsb (time-shift buffer depth, i.e. the live-edge/DVR window) is
 * segmentSeconds * segmentCount, same meaning as the standard pipeline's
 * hls_list_size -- verified during the feasibility spike to actually prune
 * old segments once exceeded (GPAC's own keep_segs=false default).
 *
 * `seg_sync=yes` (GPAC's default is `auto`, "wait for HLS") is explicit, not
 * decorative -- despite `auto` already claiming to wait for a fragment's
 * last byte before announcing it for HLS output, we reproduced the exact
 * failure this option describes ("temporary mismatches between
 * segment/part size currently received versus size as advertized in
 * manifest") against a live stream: a byte-range request for a
 * just-announced EXT-X-PART/PRELOAD-HINT offset intermittently 416'd
 * because the file hadn't grown that far *on disk* yet, and — worse for
 * Safari's native HLS player specifically — a full (non-Range) GET against
 * an in-progress segment returned a "complete-looking" 200 with a
 * Content-Length smaller than the segment's final size, i.e. truncated
 * audio silently served as whole. Forcing `yes` explicitly (rather than
 * trusting `auto`'s HLS auto-detection to already cover this) is the
 * server-not-required fix for both; see the README LL-HLS section and
 * apps/webserver/Caddyfile's `.m4s` handling for the belt-and-suspenders
 * webserver-side mitigation that remains for whatever race window persists.
 */
export function buildGpacArgs(config: EncoderConfig, stream: StreamSettingsDTO, lowFifoPath: string, highFifoPath: string): string[] {
  const cdur = partSecondsFor(stream.segmentSeconds);
  const tsb = stream.segmentSeconds * stream.segmentCount;
  const masterPath = path.join(config.hlsOutputDir, "master.m3u8");

  return [
    "-i",
    `${lowFifoPath}:ext=aac:#Bandwidth=${stream.lowBitrateKbps * 1000}:#HLSPL=low/playlist.m3u8`,
    "-i",
    `${highFifoPath}:ext=aac:#Bandwidth=${stream.highBitrateKbps * 1000}:#HLSPL=high/playlist.m3u8`,
    "-o",
    `${masterPath}:segdur=${stream.segmentSeconds}:cdur=${cdur}:llhls=br:dmode=dynamic:tsb=${tsb}:seg_sync=yes`,
  ];
}

/**
 * REAL Low Latency HLS: ffmpeg (encode only) -> two FIFOs -> a single `gpac`
 * dasher process producing genuine EXT-X-PART/EXT-X-PRELOAD-HINT byte-range
 * LL-HLS (fMP4/CMAF), replacing the standard MasterEncoder pipeline
 * whenever StreamSettings.lowLatencyEnabled is true. See masterEncoder.ts
 * for the standard (mpegts, ffmpeg-only) pipeline used otherwise.
 *
 * ffmpeg's own HLS muxer has no partial-segment support at all (confirmed
 * directly against the installed build, not assumed), and no mainstream
 * open-source alternative implements the real spec except GPAC (Shaka
 * Packager only does low-latency DASH, not HLS) -- see the Stream Settings
 * README section for the fuller writeup.
 */
export class LowLatencyEncoder {
  private ffmpeg: FfmpegProcess | null = null;
  private gpac: FfmpegProcess | null = null;
  private stopped = true;
  private restartTimer: NodeJS.Timeout | null = null;
  private healthyResetTimer: NodeJS.Timeout | null = null;
  private healthy = false;
  private backoffMs = INITIAL_BACKOFF_MS;

  constructor(
    private readonly config: EncoderConfig,
    private readonly streamSettings: StreamSettingsDTO,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.stopped = false;
    this.spawnGroup();
  }

  stop(): void {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.healthyResetTimer) clearTimeout(this.healthyResetTimer);
    this.healthy = false;
    this.ffmpeg?.kill("SIGTERM");
    this.gpac?.kill("SIGTERM");
  }

  isHealthy(): boolean {
    return this.healthy && !this.stopped;
  }

  private lowFifoPath(): string {
    return path.join(path.dirname(this.config.pcmFifoPath), LOW_FIFO_NAME);
  }

  private highFifoPath(): string {
    return path.join(path.dirname(this.config.pcmFifoPath), HIGH_FIFO_NAME);
  }

  private ensureFifo(fifoPath: string): void {
    try {
      if (fs.statSync(fifoPath).isFIFO()) return;
    } catch {
      // doesn't exist yet -- fall through to create it
    }
    execFileSync("mkfifo", [fifoPath]);
  }

  /**
   * Same reasoning as MasterEncoder.resetOutputDirs(): gpac's own segment
   * counter also restarts from 1 on a fresh process, so a crash-restart
   * would otherwise orphan the previous run's .m4s files on disk forever.
   */
  private resetOutputDirs(): void {
    for (const variant of ["low", "high"]) {
      const dir = path.join(this.config.hlsOutputDir, variant);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * ffmpeg (encode) and gpac (LL-HLS package) are supervised as ONE atomic
   * group, not independently: gpac reads from FIFOs that ffmpeg writes to,
   * so either one dying alone leaves the other stalled (gpac blocked
   * reading a now-writerless FIFO, or ffmpeg's write() blocking once gpac
   * stops draining it) rather than cleanly recovering by itself. On any
   * single exit, both are torn down and a fresh pair is spawned together --
   * same crash/backoff shape as ProcessSupervisor, generalized to a group.
   */
  private spawnGroup(): void {
    this.resetOutputDirs();
    const lowFifo = this.lowFifoPath();
    const highFifo = this.highFifoPath();
    this.ensureFifo(lowFifo);
    this.ensureFifo(highFifo);

    // gpac must be reading before ffmpeg opens the FIFOs for write -- ffmpeg's
    // own overwrite-prompt logic against a pre-created FIFO path misbehaves
    // otherwise (verified empirically during the feasibility spike).
    const gpac = new FfmpegProcess("gpac", buildGpacArgs(this.config, this.streamSettings, lowFifo, highFifo), this.logger);
    this.gpac = gpac;
    gpac.on("stderr", (line: string) => this.logger.debug({ line }, "gpac"));

    const ffmpeg = new FfmpegProcess("ffmpeg", buildLlEncodeArgs(this.config, this.streamSettings, lowFifo, highFifo), this.logger);
    this.ffmpeg = ffmpeg;
    ffmpeg.on("stderr", (line: string) => this.logger.debug({ line }, "ffmpeg[ll-encode]"));

    let groupExited = false;
    const handleExit = (source: "ffmpeg" | "gpac") => (code: number | null, signal: NodeJS.Signals | null) => {
      // The other process's own exit already triggered teardown+restart.
      if (groupExited) return;
      groupExited = true;

      this.healthy = false;
      if (this.healthyResetTimer) clearTimeout(this.healthyResetTimer);
      this.logger.warn({ source, code, signal }, "low-latency encoder process exited; restarting group");
      (source === "ffmpeg" ? gpac : ffmpeg).kill("SIGTERM");

      if (this.stopped) return;
      this.restartTimer = setTimeout(() => {
        this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
        this.spawnGroup();
      }, this.backoffMs);
    };
    gpac.on("exit", handleExit("gpac"));
    ffmpeg.on("exit", handleExit("ffmpeg"));
    gpac.on("error", () => {});
    ffmpeg.on("error", () => {});

    gpac.start();
    ffmpeg.start();

    this.healthy = true;
    this.healthyResetTimer = setTimeout(() => {
      if (!this.stopped) this.backoffMs = INITIAL_BACKOFF_MS;
    }, HEALTHY_UPTIME_MS);
  }
}
