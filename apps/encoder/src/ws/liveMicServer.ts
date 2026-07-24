import { WebSocketServer, type WebSocket } from "ws";
import type { Logger } from "../util/logger.js";

/**
 * STUB (partially real): a `ws` server that genuinely accepts connections on
 * LIVE_MIC_WS_PORT (matching what nginx will proxy `/live-mic/` to per the
 * webserver config), so the socket handshake itself is provable end-to-end.
 * It does NOT decode or mix incoming audio yet.
 *
 * TODO (full design): on `connection`, correlate the socket to a
 * LiveStartCommand.sessionId (e.g. via a query param or an initial JSON
 * control frame), spawn a per-session WebM/Opus decode ffmpeg process,
 * frame its PCM output through core/pcmFraming.ts into a
 * core/ringBuffer.ts, and construct a sources/micSource.ts that
 * liveMicController mounts as the "mic" overlay slot.
 */
export class LiveMicServer {
  private wss: WebSocketServer | null = null;

  constructor(
    private readonly port: number,
    private readonly logger: Logger,
  ) {}

  start(): void {
    const wss = new WebSocketServer({ port: this.port });
    this.wss = wss;

    wss.on("connection", (socket: WebSocket, request) => {
      this.logger.info({ remoteAddress: request.socket.remoteAddress }, "live-mic websocket connected");
      let warnedOnce = false;

      socket.on("message", (_data, isBinary) => {
        if (!isBinary) {
          this.logger.debug("live-mic websocket received a non-binary message; ignoring");
          return;
        }
        if (!warnedOnce) {
          warnedOnce = true;
          this.logger.warn(
            "live-mic websocket received binary audio frames but decode/mix is not implemented - TODO: decode WebM/Opus into micSource per full design",
          );
        }
      });

      socket.on("close", () => this.logger.info("live-mic websocket disconnected"));
      socket.on("error", (err) => this.logger.warn({ err }, "live-mic websocket error"));
    });

    wss.on("error", (err) => this.logger.error({ err }, "live-mic websocket server error"));

    this.logger.info({ port: this.port }, "live-mic websocket server listening");
  }

  stop(): void {
    this.wss?.close();
    this.wss = null;
  }
}
