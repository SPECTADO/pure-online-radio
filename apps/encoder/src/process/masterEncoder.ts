import * as fs from "node:fs";
import * as path from "node:path";
import type { EncoderConfig } from "../config.js";
import type { Logger } from "../util/logger.js";
import { FfmpegProcess } from "./ffmpegProcess.js";
import { ProcessSupervisor } from "./processSupervisor.js";

const HLS_SEGMENT_SECONDS = 4;
const HLS_LIST_SIZE = 8;

/**
 * Builds the argv for the persistent HLS-encode ffmpeg process: reads raw
 * f32le PCM from the master FIFO, and produces two AAC variants (low 64k
 * mono/44100, high 256k stereo/48000) as an HLS master playlist + two
 * variant playlists under HLS_OUTPUT_DIR, via ffmpeg's -var_stream_map/%v
 * mechanism. Exported standalone (not just inlined in the class) so it can
 * be unit-tested without spawning anything.
 */
export function buildMasterEncoderArgs(config: EncoderConfig): string[] {
  return [
    "-nostdin",
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
    "64k",
    "-ar",
    "44100",
    "-ac",
    "1",

    "-map",
    "[high_in]",
    "-c:a",
    "aac",
    "-b:a",
    "256k",
    "-ar",
    "48000",
    "-ac",
    "2",

    "-f",
    "hls",
    "-hls_time",
    String(HLS_SEGMENT_SECONDS),
    "-hls_list_size",
    String(HLS_LIST_SIZE),
    "-hls_flags",
    "delete_segments+append_list+independent_segments+program_date_time",
    "-hls_segment_type",
    "mpegts",
    "-master_pl_name",
    "master.m3u8",
    "-var_stream_map",
    "a:0,name:low a:1,name:high",
    "-hls_segment_filename",
    path.join(config.hlsOutputDir, "%v", "segment_%08d.ts"),
    path.join(config.hlsOutputDir, "%v", "playlist.m3u8"),
  ];
}

/**
 * REAL: owns the single persistent HLS-encode ffmpeg process. Wrapped by
 * ProcessSupervisor so a crash respawns it - the FIFO fd owned by
 * FifoWriter is unaffected by that (see fifoWriter.ts for why: it holds an
 * independent read+write fd on the same named pipe, so it never sees EOF and
 * doesn't need to reopen anything when this process restarts).
 */
export class MasterEncoder {
  private readonly supervisor: ProcessSupervisor;

  constructor(
    private readonly config: EncoderConfig,
    private readonly logger: Logger,
  ) {
    this.supervisor = new ProcessSupervisor(() => this.createProcess(), this.logger.child({ component: "masterEncoder" }));
  }

  start(): void {
    this.ensureOutputDirs();
    this.supervisor.start();
  }

  stop(): void {
    this.supervisor.stop();
  }

  isHealthy(): boolean {
    return this.supervisor.isHealthy();
  }

  /**
   * ffmpeg's HLS muxer does not create the `%v` variant subdirectories
   * (low/, high/) on its own - it just opens files under whatever path is
   * given, and fails if the directory doesn't exist yet.
   */
  private ensureOutputDirs(): void {
    fs.mkdirSync(path.join(this.config.hlsOutputDir, "low"), { recursive: true });
    fs.mkdirSync(path.join(this.config.hlsOutputDir, "high"), { recursive: true });
  }

  private createProcess(): FfmpegProcess {
    const args = buildMasterEncoderArgs(this.config);
    const proc = new FfmpegProcess("ffmpeg", args, this.logger);
    proc.on("stderr", (line: string) => this.logger.debug({ line }, "ffmpeg[master]"));
    proc.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      this.logger.warn({ code, signal }, "master encoder ffmpeg process exited");
    });
    return proc;
  }
}
