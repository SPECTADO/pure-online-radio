import type { Logger } from "../util/logger.js";
import type { FfmpegProcess } from "./ffmpegProcess.js";

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;
/** How long a process must stay up before we consider it "healthy again" and reset backoff to the initial value. */
const HEALTHY_UPTIME_MS = 10_000;

export type ProcessFactory = () => FfmpegProcess;

/**
 * Generic crash/restart supervisor for an FfmpegProcess. Wraps a factory
 * function (so a fresh process + fresh argv can be built on every restart)
 * and, on an unexpected exit, restarts with exponential backoff
 * (500ms -> 1s -> 2s -> 4s, capped at 8s). Backoff resets to 500ms once a
 * respawned process survives HEALTHY_UPTIME_MS, so a single blip doesn't
 * permanently slow down future restarts.
 *
 * Used by masterEncoder.ts today; any future long-running ffmpeg process
 * (a decode source, an external relay ingest) can reuse this unchanged.
 */
export class ProcessSupervisor {
  private current: FfmpegProcess | null = null;
  private backoffMs = INITIAL_BACKOFF_MS;
  private stopped = true;
  private restartTimer: NodeJS.Timeout | null = null;
  private healthyResetTimer: NodeJS.Timeout | null = null;
  private healthy = false;

  constructor(
    private readonly factory: ProcessFactory,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.stopped = false;
    this.spawn();
  }

  stop(): void {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.healthyResetTimer) clearTimeout(this.healthyResetTimer);
    this.healthy = false;
    this.current?.kill("SIGTERM");
  }

  /** Whether the currently-supervised process is up and has been considered started. */
  isHealthy(): boolean {
    return this.healthy && !this.stopped;
  }

  private spawn(): void {
    const proc = this.factory();
    this.current = proc;

    proc.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      this.healthy = false;
      if (this.healthyResetTimer) clearTimeout(this.healthyResetTimer);
      if (this.stopped) {
        this.logger.info({ code, signal }, "supervised process exited after stop()");
        return;
      }
      this.logger.error({ code, signal, nextRestartMs: this.backoffMs }, "supervised process exited unexpectedly; scheduling restart");
      this.restartTimer = setTimeout(() => {
        this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
        this.spawn();
      }, this.backoffMs);
    });

    proc.on("error", () => {
      // "exit" also fires after a failed spawn in Node, so no separate
      // restart logic is needed here; this handler just prevents an
      // unhandled 'error' event from crashing the process.
    });

    proc.start();
    this.healthy = true;
    this.healthyResetTimer = setTimeout(() => {
      if (!this.stopped) {
        this.backoffMs = INITIAL_BACKOFF_MS;
      }
    }, HEALTHY_UPTIME_MS);
  }
}
