import type { HeartbeatStatus } from "@spectado/shared-types";

/**
 * In-memory only (unlike now-playing, which is cross-instance state in
 * Redis) -- the system status page only ever needs "has *this* api process
 * heard from the encoder recently", not a durable/shared value.
 */
let latest: { status: HeartbeatStatus; receivedAt: number } | null = null;

export function setLatestHeartbeat(status: HeartbeatStatus): void {
  latest = { status, receivedAt: Date.now() };
}

export function getLatestHeartbeat(): { status: HeartbeatStatus; receivedAt: number } | null {
  return latest;
}
