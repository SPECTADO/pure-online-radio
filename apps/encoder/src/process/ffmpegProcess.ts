import { spawn, type ChildProcessByStdio } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";
import type { Logger } from "../util/logger.js";

/**
 * Generic child-process wrapper around ffmpeg (or any other binary, really).
 * Used by masterEncoder.ts today for the persistent HLS-encode process, and
 * intended for reuse by future decode sources (queueSource/relaySource/
 * micSource all eventually spawn `ffmpeg -i <url> -f f32le pipe:1` and read
 * stdout via pcmFraming.ts).
 *
 * Emits:
 *   - "stdout" (chunk: Buffer)       raw stdout bytes (PCM for decode sources)
 *   - "stderr" (line: string)        ffmpeg logs one line at a time
 *   - "exit"   (code, signal)        process has exited
 *   - "error"  (err: Error)          failed to spawn / runtime error
 */
export class FfmpegProcess extends EventEmitter {
  private child: ChildProcessByStdio<Writable, Readable, Readable> | null = null;
  private stderrCarry = "";

  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly logger: Logger,
  ) {
    super();
  }

  start(): void {
    this.logger.info({ command: this.command, args: this.args }, "spawning child process");
    const child = spawn(this.command, this.args, { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;

    child.stdout.on("data", (chunk: Buffer) => {
      this.emit("stdout", chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrCarry += chunk.toString("utf8");
      const lines = this.stderrCarry.split("\n");
      this.stderrCarry = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length > 0) this.emit("stderr", line);
      }
    });

    child.on("error", (err) => {
      this.logger.error({ err, command: this.command }, "ffmpeg process failed to spawn");
      this.emit("error", err);
    });

    child.on("exit", (code, signal) => {
      this.emit("exit", code, signal);
    });
  }

  /** Standard input stream, for decode sources that feed ffmpeg over stdin instead of a URL. */
  get stdin(): Writable | null {
    return this.child?.stdin ?? null;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): void {
    this.child?.kill(signal);
  }
}
