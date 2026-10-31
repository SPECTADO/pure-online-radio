import { logger } from "../../logger.js";

/**
 * In-process only -- a single guard against two concurrent broadcasts, and the sessionId this
 * api instance last handed out. Safe as plain memory: docker-compose.yml runs one `api`
 * instance (no replicas configured), the same assumption modules/realtime/realtime.routes.ts's
 * NATS-ws credential broker already makes. The encoder (not the api) is the actual authority on
 * whether a session's websocket is authorized and whether a mic is on air -- see
 * LiveMicServer/LiveMicController -- so this guard must follow the encoder's lead, not just the
 * explicit `/stop` route: a broadcast also ends when the browser's socket drops (tab closed,
 * manager navigated away from the Dashboard, network blip), when the browser never connects at
 * all, or when the encoder restarts. Before that was wired up, any of those left `activeSession`
 * set for its full 6h TTL and every later "go on air" got 409 "a live mic session is already
 * active" until the api restarted.
 */
interface ActiveSession {
  sessionId: string;
  expiresAt: Date;
  startedAtMs: number;
}

let activeSession: ActiveSession | null = null;

/** A heartbeat reporting no mic mounted only proves the session is gone once the encoder has had
 * time to receive LiveStartCommand and mount it -- generous, heartbeats are ~5s apart anyway. */
const HEARTBEAT_GRACE_MS = 10_000;

export function getActiveLiveMicSession(): ActiveSession | null {
  if (activeSession && activeSession.expiresAt <= new Date()) activeSession = null;
  return activeSession;
}

export function setActiveLiveMicSession(sessionId: string, expiresAt: Date): void {
  activeSession = { sessionId, expiresAt, startedAtMs: Date.now() };
}

/** Clears the guard if (and only if) `sessionId` is still the active one -- a late liveEnded or
 * /stop for an older session must not clear a newer broadcast. */
export function clearLiveMicSession(sessionId: string, reason: string): void {
  if (activeSession?.sessionId !== sessionId) return;
  activeSession = null;
  logger.info({ sessionId, reason }, "[live-mic] session cleared");
}

/** Backstop for a session that ended without a liveEnded status reaching us (encoder crashed or
 * restarted mid-broadcast): the encoder's heartbeat says no mic slot is mounted. */
export function reconcileLiveMicWithHeartbeat(micMounted: boolean): void {
  if (!activeSession || micMounted) return;
  if (Date.now() - activeSession.startedAtMs < HEARTBEAT_GRACE_MS) return;
  clearLiveMicSession(activeSession.sessionId, "encoder heartbeat reports no mic mounted");
}
