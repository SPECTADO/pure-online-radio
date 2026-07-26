import type { ScheduleInsertionMode, ScheduleTriggerType, TimeFormat } from "@spectado/shared-types";
import { fromDatetimeLocalValue, formatDateTime, toDatetimeLocalValue } from "./format";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Plain-string form state for ScheduleTriggerFields -- every trigger-type's fields are
 * always present so switching triggerType in the UI never loses what was typed into
 * fields not currently shown. Converted to/from the wire DTO only at read/submit time. */
export interface TriggerFormState {
  triggerType: ScheduleTriggerType;
  insertionMode: ScheduleInsertionMode;
  runAt: string; // datetime-local value
  weekdays: number[]; // 0=Sun..6=Sat
  timeOfDay: string; // "HH:mm" or ""
  intervalMinutes: string;
  windowStart: string; // "HH:mm" or ""
  windowEnd: string; // "HH:mm" or ""
  everyNPlays: string;
}

export const DEFAULT_TRIGGER_FORM_STATE: TriggerFormState = {
  triggerType: "ONE_TIME",
  insertionMode: "ASAP",
  runAt: "",
  weekdays: [],
  timeOfDay: "",
  intervalMinutes: "",
  windowStart: "",
  windowEnd: "",
  everyNPlays: "",
};

interface TriggerDTOFields {
  triggerType: ScheduleTriggerType;
  insertionMode: ScheduleInsertionMode;
  runAt?: string | null;
  weekdays?: number[];
  timeOfDay?: string | null;
  intervalMinutes?: number | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  everyNPlays?: number | null;
}

export function triggerToFormState(trigger: TriggerDTOFields): TriggerFormState {
  return {
    triggerType: trigger.triggerType,
    insertionMode: trigger.insertionMode,
    runAt: trigger.runAt ? toDatetimeLocalValue(trigger.runAt) : "",
    weekdays: trigger.weekdays ?? [],
    timeOfDay: trigger.timeOfDay ?? "",
    intervalMinutes: trigger.intervalMinutes ? String(trigger.intervalMinutes) : "",
    windowStart: trigger.windowStart ?? "",
    windowEnd: trigger.windowEnd ?? "",
    everyNPlays: trigger.everyNPlays ? String(trigger.everyNPlays) : "",
  };
}

/** Only the fields relevant to `state.triggerType` are populated -- the rest are sent as
 * null/empty so a stale value from a previously-selected trigger type never leaks through. */
export function triggerFormStateToPayload(state: TriggerFormState): TriggerDTOFields {
  return {
    triggerType: state.triggerType,
    insertionMode: state.insertionMode,
    runAt: state.triggerType === "ONE_TIME" && state.runAt ? fromDatetimeLocalValue(state.runAt) : null,
    weekdays: state.triggerType === "WEEKLY" || state.triggerType === "INTERVAL" ? state.weekdays : [],
    timeOfDay: state.triggerType === "WEEKLY" && state.timeOfDay ? state.timeOfDay : null,
    intervalMinutes: state.triggerType === "INTERVAL" && state.intervalMinutes ? Number(state.intervalMinutes) : null,
    windowStart: state.triggerType === "INTERVAL" && state.windowStart ? state.windowStart : null,
    windowEnd: state.triggerType === "INTERVAL" && state.windowEnd ? state.windowEnd : null,
    everyNPlays: state.triggerType === "PLAY_COUNT" && state.everyNPlays ? Number(state.everyNPlays) : null,
  };
}

function describeWeekdays(weekdays: number[]): string {
  if (weekdays.length === 0) return "every day";
  if (weekdays.length === 7) return "every day";
  return weekdays
    .slice()
    .sort()
    .map((d) => WEEKDAY_LABELS[d])
    .join("/");
}

/** One-line human summary for a table row, e.g. "Weekly: Mon/Wed/Fri at 08:00". */
export function describeTrigger(trigger: TriggerDTOFields, timeFormat: TimeFormat): string {
  switch (trigger.triggerType) {
    case "ONE_TIME":
      return trigger.runAt ? `Once at ${formatDateTime(trigger.runAt, timeFormat)}` : "Once (not yet set)";
    case "WEEKLY":
      return `Weekly: ${describeWeekdays(trigger.weekdays ?? [])} at ${trigger.timeOfDay ?? "—"}`;
    case "INTERVAL": {
      const window =
        trigger.windowStart || trigger.windowEnd
          ? ` (${trigger.windowStart ?? "00:00"}–${trigger.windowEnd ?? "24:00"})`
          : "";
      return `Every ${trigger.intervalMinutes ?? "?"} min, ${describeWeekdays(trigger.weekdays ?? [])}${window}`;
    }
    case "PLAY_COUNT":
      return `Every ${trigger.everyNPlays ?? "?"} songs played`;
  }
}
