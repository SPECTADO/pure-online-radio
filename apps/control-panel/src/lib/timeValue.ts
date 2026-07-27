import type { TimeFormat } from "@spectado/shared-types";

/** "HH:mm" (24h) -- the wire/form value format used by TimePicker and the
 * time portion of DateTimePicker, matching the plain strings ClockWheelSlotEditor
 * and scheduleTrigger.ts already pass around (e.g. "06:00"). */
export function parseTimeValue(value: string): { hour: number; minute: number } {
  const [hPart, mPart] = value.split(":");
  const h = Number.parseInt(hPart ?? "", 10);
  const m = Number.parseInt(mPart ?? "", 10);
  return { hour: Number.isFinite(h) ? h : 0, minute: Number.isFinite(m) ? m : 0 };
}

export function formatTimeValue(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Wraps `value` back into [min, max] instead of clamping -- so stepping past
 * 23 rolls to 0, past 0 rolls to 23, etc. */
export function clampWrap(value: number, min: number, max: number): number {
  const range = max - min + 1;
  return ((((value - min) % range) + range) % range) + min;
}

/** Locale-formatted display string for a trigger button, e.g. "6:00 AM" --
 * respects the station's 12h/24h preference like lib/format.ts's formatTimeOfDay. */
export function formatTimeDisplay(value: string, timeFormat: TimeFormat): string {
  const { hour, minute } = parseTimeValue(value);
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: timeFormat === "12h",
  });
}
