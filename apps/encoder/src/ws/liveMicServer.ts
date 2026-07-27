import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { Logger } from "../util/logger.js";
import type { MicSource } from "../sources/micSource.js";

interface AttachedSession {
  source: MicSource;
  token: string;
  expiresAtMs: number;
  socket: WebSocket | null;
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

/**
 * REAL: accepts the browser's mic-ingest websocket connection at `/<sessionId>?token=...`
 * (Caddy strips the `/live-mic` prefix before proxying here -- apps/webserver/Caddyfile) and
 * correlates it to the `MicSource` liveMicController already mounted into the mixer for that
 * session. `attachSession` is always called *before* the browser's socket can possibly connect:
 * the api only hands `LiveMicSessionDTO` back to the browser after publishing `LiveStartCommand`,
 * which is what drives `LiveMicController.handleLiveStart` -> `attachSession`.
 */
export class LiveMicServer {
  private wss: WebSocketServer | null = null;
  private readonly sessions = new Map<string, AttachedSession>();

  constructor(
    private readonly port: number,
    private readonly logger: Logger,
    /** Notified when a session's socket closes without an explicit LiveStopCommand having
     * already detached it (network drop, tab close) -- lets the controller unmount + publish
     * liveEnded even though nothing told it to stop. */
    private readonly onSocketClosed: (sessionId: string) => void,
  ) {}

  /** Authorizes `sessionId`/`token` to carry audio for `source` -- this IS the "validate
   * token/expiresAt" authorization step; a socket presenting anything else is rejected. */
  attachSession(sessionId: string, source: MicSource, token: string, expiresAtMs: number): void {
    this.sessions.set(sessionId, { source, token, expiresAtMs, socket: null });
  }

  /** Revokes a session and closes its socket if one is currently connected -- called on
   * LiveStopCommand, and again (idempotently) once the controller finishes tearing down after
   * an unsolicited socket close. */
  detachSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    session?.socket?.close();
  }

  start(): void {
    const wss = new WebSocketServer({ port: this.port });
    this.wss = wss;

    wss.on("connection", (socket: WebSocket, request) => {
      const url = new URL(request.url ?? "/", "http://internal");
      const sessionId = url.pathname.replace(/^\/+/, "");
      const token = url.searchParams.get("token");
      const remoteAddress = request.socket.remoteAddress;

      const session = this.sessions.get(sessionId);
      if (!session || session.token !== token || session.expiresAtMs < Date.now()) {
        this.logger.warn({ sessionId, remoteAddress }, "live-mic websocket rejected: unknown, expired, or mismatched session");
        socket.close(4001, "unauthorized");
        return;
      }

      session.socket = socket;
      this.logger.info({ sessionId, remoteAddress }, "live-mic websocket connected");

      socket.on("message", (data: RawData, isBinary: boolean) => {
        if (!isBinary) return;
        session.source.write(toBuffer(data));
      });

      socket.on("close", () => {
        this.logger.info({ sessionId }, "live-mic websocket disconnected");
        // Only fire if this socket is still the one on record for the session -- avoids a
        // stale/duplicate close (e.g. after detachSession already closed it) re-triggering teardown.
        if (this.sessions.get(sessionId)?.socket === socket) {
          this.onSocketClosed(sessionId);
        }
      });
      socket.on("error", (err) => this.logger.warn({ err, sessionId }, "live-mic websocket error"));
    });

    wss.on("error", (err) => this.logger.error({ err }, "live-mic websocket server error"));

    this.logger.info({ port: this.port }, "live-mic websocket server listening");
  }

  stop(): void {
    this.wss?.close();
    this.wss = null;
  }
}
