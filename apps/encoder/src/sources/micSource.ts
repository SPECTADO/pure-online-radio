import type { LiveStartCommand } from "@spectado/shared-types";
import type { Source } from "../core/types.js";
import type { Logger } from "../util/logger.js";
import type { RingBuffer } from "../core/ringBuffer.js";

/**
 * STUB - not implemented in this pass.
 *
 * TODO (full design): fed by ws/liveMicServer.ts, which will decode incoming
 * WebM/Opus binary websocket frames (likely via a small ffmpeg child process
 * per session, `ffmpeg -f webm -i pipe:0 -f f32le -ar 48000 -ac 2 pipe:1`,
 * framed through core/pcmFraming.ts) into a jitter buffer
 * (core/ringBuffer.ts) that this source drains from at the mixer's 20ms
 * cadence. Mounted as an overlay `Slot` (core/types.ts, kind: "mic") by
 * liveMicController on LiveStartCommand, with its own ducking GainEnvelope
 * applied to the primary bus, unmounted on LiveStopCommand or socket close.
 */
export class MicSource implements Source {
  private warnedOnce = false;

  constructor(
    private readonly command: LiveStartCommand,
    private readonly jitterBuffer: RingBuffer<Buffer> | null,
    private readonly logger: Logger,
  ) {}

  getFrame(): Float32Array | null {
    if (!this.warnedOnce) {
      this.warnedOnce = true;
      this.logger.warn(
        { sessionId: this.command.sessionId },
        "MicSource.getFrame not implemented - TODO: drain decoded WebM/Opus jitter buffer fed by ws/liveMicServer.ts",
      );
    }
    return null;
  }
}
