import type { ScheduleInsertionMode, ScheduleTriggerType } from "@spectado/shared-types";
import type { TriggerFormState } from "../lib/scheduleTrigger";
import { DateTimePicker } from "./DateTimePicker";
import { TimePicker } from "./TimePicker";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

/** Trigger-type + insertion-mode form section shared by the schedule-rule and
 * external-stream create/edit modals -- only the fields relevant to the selected
 * triggerType are shown. */
export function ScheduleTriggerFields({
  value,
  onChange,
}: {
  value: TriggerFormState;
  onChange: (next: TriggerFormState) => void;
}) {
  function set<K extends keyof TriggerFormState>(key: K, v: TriggerFormState[K]) {
    onChange({ ...value, [key]: v });
  }

  function toggleWeekday(day: number) {
    set(
      "weekdays",
      value.weekdays.includes(day)
        ? value.weekdays.filter((d) => d !== day)
        : [...value.weekdays, day].sort((a, b) => a - b),
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border border-slate-200 p-3">
      <div className="grid grid-cols-2 gap-4">
        <label>
          <span className={labelClass}>Trigger</span>
          <select
            value={value.triggerType}
            onChange={(e) => set("triggerType", e.target.value as ScheduleTriggerType)}
            className={inputClass}
          >
            <option value="ONE_TIME">Specific date &amp; time</option>
            <option value="WEEKLY">Day of week + time</option>
            <option value="INTERVAL">Repeat interval</option>
            <option value="PLAY_COUNT">Every X songs played</option>
          </select>
        </label>
        <label>
          <span className={labelClass}>Insertion</span>
          <select
            value={value.insertionMode}
            onChange={(e) => set("insertionMode", e.target.value as ScheduleInsertionMode)}
            className={inputClass}
          >
            <option value="ASAP">As soon as possible (finish current item first)</option>
            <option value="AT_TIME">At the time (interrupt current item)</option>
          </select>
        </label>
      </div>

      {value.triggerType === "ONE_TIME" && (
        <label>
          <span className={labelClass}>Date &amp; time</span>
          <DateTimePicker value={value.runAt} onChange={(runAt) => set("runAt", runAt)} />
        </label>
      )}

      {(value.triggerType === "WEEKLY" || value.triggerType === "INTERVAL") && (
        <div>
          <span className={labelClass}>
            {value.triggerType === "INTERVAL" ? "Days (none selected = every day)" : "Days"}
          </span>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_LABELS.map((label, day) => (
              <button
                type="button"
                key={day}
                onClick={() => toggleWeekday(day)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                  value.weekdays.includes(day)
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {value.triggerType === "WEEKLY" && (
        <label>
          <span className={labelClass}>Time of day</span>
          <TimePicker value={value.timeOfDay} onChange={(timeOfDay) => set("timeOfDay", timeOfDay)} />
        </label>
      )}

      {value.triggerType === "INTERVAL" && (
        <>
          <label>
            <span className={labelClass}>Repeat every (minutes)</span>
            <input
              type="number"
              min={1}
              value={value.intervalMinutes}
              onChange={(e) => set("intervalMinutes", e.target.value)}
              className={inputClass}
            />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label>
              <span className={labelClass}>Window start (optional, default midnight)</span>
              <TimePicker value={value.windowStart} onChange={(windowStart) => set("windowStart", windowStart)} />
            </label>
            <label>
              <span className={labelClass}>Window end (optional, default end of day)</span>
              <TimePicker value={value.windowEnd} onChange={(windowEnd) => set("windowEnd", windowEnd)} />
            </label>
          </div>
        </>
      )}

      {value.triggerType === "PLAY_COUNT" && (
        <label>
          <span className={labelClass}>Every N songs played</span>
          <input
            type="number"
            min={1}
            value={value.everyNPlays}
            onChange={(e) => set("everyNPlays", e.target.value)}
            className={inputClass}
          />
        </label>
      )}
    </div>
  );
}
