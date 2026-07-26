import type { TimeFormat } from "@spectado/shared-types";

/** "3:07"-style duration formatting for durationMs fields shared across DTOs. */
export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** "3:45:07 PM"-style clock time (no date) for an epoch-ms timestamp -- respects
 * the station's 12h/24h display preference (see lib/useTimeFormat.ts). */
export function formatTimeOfDay(ms: number, timeFormat: TimeFormat = "12h"): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: timeFormat === "12h",
  });
}

export function formatDateTime(iso: string | null, timeFormat: TimeFormat = "12h"): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString([], { hour12: timeFormat === "12h" });
  } catch {
    return iso;
  }
}

/** ISO datetime -> the local-time value a `<input type="datetime-local">`
 * expects ("YYYY-MM-DDTHH:mm"). */
export function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The reverse of toDatetimeLocalValue -- local wall-clock value -> ISO
 * string in UTC, ready for a `z.string().datetime()` field. */
export function fromDatetimeLocalValue(value: string): string {
  return new Date(value).toISOString();
}
