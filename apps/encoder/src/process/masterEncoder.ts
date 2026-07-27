import * as fs from "node:fs";
import * as path from "node:path";
import type { StreamCodec, StreamSettingsDTO } from "@spectado/shared-types";
import type { EncoderConfig } from "../config.js";
import type { Logger } from "../util/logger.js";
import { FfmpegProcess } from "./ffmpegProcess.js";
import { ProcessSupervisor } from "./processSupervisor.js";

const CODEC_ENCODER_NAME: Record<StreamCodec, string> = {
  AAC: "aac",
  MP3: "libmp3lame",
};

/**
 * Builds the argv for the persistent HLS-encode ffmpeg process: reads raw
 * f32le PCM from the master FIFO, and produces two variants (low/high
 * bitrate, same codec, low forced to mono/44100 and high to stereo/48000)
 * as an HLS master playlist + two variant playlists under HLS_OUTPUT_DIR,
 * via ffmpeg's -var_stream_map/%v mechanism. Exported standalone (not just
 * inlined in the class) so it can be unit-tested without spawning anything.
 *
 * Only used when StreamSettings.lowLatencyEnabled is false -- the true case
 * is handled entirely by llHlsEncoder.ts's LowLatencyEncoder instead (a
 * genuine ffmpeg+gpac LL-HLS pipeline), selected in index.ts before either
 * class is ever constructed.
 */
export function buildMasterEncoderArgs(config: EncoderConfig, stream: StreamSettingsDTO): string[] {
  const encoderName = CODEC_ENCODER_NAME[stream.codec];

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
    encoderName,
    "-b:a",
    `${stream.lowBitrateKbps}k`,
    "-ar",
    "44100",
    "-ac",
    "1",

    "-map",
    "[high_in]",
    "-c:a",
    encoderName,
    "-b:a",
    `${stream.highBitrateKbps}k`,
    "-ar",
    "48000",
    "-ac",
    "2",

    "-f",
    "hls",
    "-hls_time",
    String(stream.segmentSeconds),
    "-hls_list_size",
    String(stream.segmentCount),
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
    private readonly streamSettings: StreamSettingsDTO,
    private readonly logger: Logger,
  ) {
    this.supervisor = new ProcessSupervisor(() => this.createProcess(), this.logger.child({ component: "masterEncoder" }));
  }

  start(): void {
    this.supervisor.start();
  }

  stop(): void {
    this.supervisor.stop();
  }

  isHealthy(): boolean {
    return this.supervisor.isHealthy();
  }

  /**
   * Wipes and recreates the `%v` variant subdirectories (low/, high/) before
   * every fresh ffmpeg spawn -- both the initial boot and every
   * ProcessSupervisor crash-restart, since this is the factory it calls each
   * time. ffmpeg's own `delete_segments` flag only prunes segments its
   * *current* process created; a segment left over from a previous process
   * (crash mid-run, or a settings-change restart) would otherwise never be
   * referenced by the new process's playlist and leak on disk forever. A
   * crash already causes a real playback discontinuity, so clearing the
   * directory here doesn't make that outage meaningfully worse.
   */
  private resetOutputDirs(): void {
    for (const variant of ["low", "high"]) {
      const dir = path.join(this.config.hlsOutputDir, variant);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private createProcess(): FfmpegProcess {
    this.resetOutputDirs();
    const args = buildMasterEncoderArgs(this.config, this.streamSettings);
    const proc = new FfmpegProcess("ffmpeg", args, this.logger);
    proc.on("stderr", (line: string) => this.logger.debug({ line }, "ffmpeg[master]"));
    proc.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      this.logger.warn({ code, signal }, "master encoder ffmpeg process exited");
    });
    return proc;
  }
}
