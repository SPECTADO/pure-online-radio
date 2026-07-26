import { rowActionButton, rowActionButtonDanger } from "../lib/buttonStyles";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Client-side only -- `key` is a stable id for list rendering, never sent to the API. */
export interface EditableSlot {
  key: string;
  weekdays: number[];
  startTime: string; // "HH:mm"
  endTime: string;
}

const timeInputClass =
  "rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

/** Add/remove/edit a clock wheel's day-of-week + time-range windows. Not rendered at all
 * for the default wheel (it has no slots of its own -- see ClockWheelModal). */
export function ClockWheelSlotEditor({
  slots,
  onChange,
}: {
  slots: EditableSlot[];
  onChange: (slots: EditableSlot[]) => void;
}) {
  function addSlot() {
    onChange([...slots, { key: crypto.randomUUID(), weekdays: [1, 2, 3, 4, 5], startTime: "06:00", endTime: "10:00" }]);
  }

  function updateSlot(key: string, patch: Partial<EditableSlot>) {
    onChange(slots.map((slot) => (slot.key === key ? { ...slot, ...patch } : slot)));
  }

  function removeSlot(key: string) {
    onChange(slots.filter((slot) => slot.key !== key));
  }

  function toggleWeekday(slot: EditableSlot, day: number) {
    updateSlot(slot.key, {
      weekdays: slot.weekdays.includes(day)
        ? slot.weekdays.filter((d) => d !== day)
        : [...slot.weekdays, day].sort((a, b) => a - b),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {slots.length === 0 && (
        <p className="text-sm text-slate-500">No day/time windows yet -- add one below.</p>
      )}

      {slots.map((slot) => (
        <div key={slot.key} className="rounded-md border border-slate-200 p-3">
          <div className="mb-3 flex flex-wrap gap-2">
            {WEEKDAY_LABELS.map((label, day) => (
              <button
                type="button"
                key={day}
                onClick={() => toggleWeekday(slot, day)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                  slot.weekdays.includes(day)
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              From
              <input
                type="time"
                value={slot.startTime}
                onChange={(e) => updateSlot(slot.key, { startTime: e.target.value })}
                className={timeInputClass}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              To
              <input
                type="time"
                value={slot.endTime}
                onChange={(e) => updateSlot(slot.key, { endTime: e.target.value })}
                className={timeInputClass}
              />
            </label>
            <button type="button" onClick={() => removeSlot(slot.key)} className={`ml-auto ${rowActionButtonDanger}`}>
              Remove
            </button>
          </div>
        </div>
      ))}

      <button type="button" onClick={addSlot} className={`self-start ${rowActionButton}`}>
        + Add day/time window
      </button>
    </div>
  );
}
