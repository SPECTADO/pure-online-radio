import { useEffect, useState } from "react";
import { HEARTBEAT_STALE_MS, NATS_SUBJECTS, type HeartbeatStatus } from "@spectado/shared-types";
import { useConnectionStatus, useNatsSubject } from "./natsClient";

export type EncoderOnAirStatus =
  | "connecting"
  | "offline"
  | "connection-error"
  | "checking"
  | "live"
  | "degraded"
  | "off-air";

/**
 * Real on-air status, derived from the encoder's own heartbeat -- NOT just
 * whether this browser tab's NATS-ws connection happens to be up (that alone
 * only proves the control panel can reach NATS, not that the encoder is
 * running or producing audio). "live" means a heartbeat arrived within
 * HEARTBEAT_STALE_MS reporting a healthy HLS writer; "off-air" means the
 * connection is fine but no fresh heartbeat has arrived (encoder down or
 * crashed); "degraded" means a fresh heartbeat arrived but flagged its own
 * HLS writer unhealthy. Mirrors the api's /status checkEncoder() logic
 * (same HEARTBEAT_STALE_MS threshold) without needing to poll that route
 * from every open tab just to render a badge.
 */
export function useEncoderOnAirStatus(): EncoderOnAirStatus {
  const connectionStatus = useConnectionStatus();
  const [heartbeat, setHeartbeat] = useState<{ status: HeartbeatStatus; receivedAt: number } | null>(null);

  useNatsSubject<HeartbeatStatus>(NATS_SUBJECTS.encoderStatus.heartbeat, (status) => {
    setHeartbeat({ status, receivedAt: Date.now() });
  });

  // Heartbeats only arrive while the encoder is alive -- without our own
  // ticking clock, a dead encoder would leave the last-seen status stuck at
  // whatever it read on its final heartbeat instead of aging into "off-air".
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 2000);
    return () => clearInterval(id);
  }, []);

  if (connectionStatus === "connecting") return "connecting";
  if (connectionStatus === "disconnected") return "offline";
  if (connectionStatus === "error") return "connection-error";

  if (!heartbeat) return "checking";
  if (Date.now() - heartbeat.receivedAt > HEARTBEAT_STALE_MS) return "off-air";
  return heartbeat.status.hlsWriterHealthy ? "live" : "degraded";
}
