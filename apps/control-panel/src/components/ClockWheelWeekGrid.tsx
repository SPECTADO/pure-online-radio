import type { ClockWheelDTO } from "@spectado/shared-types";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_MARKS = [0, 6, 12, 18, 24];

// Fixed categorical order (never cycled per-render, always assigned by stable wheel
// order) -- validated for CVD-safe adjacent separation and light-surface contrast via
// the dataviz skill's validate_palette.js. Six distinguishable wheels before it wraps,
// which comfortably covers a real station's rotation count.
const WHEEL_COLORS = ["#2563eb", "#d97706", "#7c3aed", "#0d9488", "#e11d48", "#4f46e5"];

interface Interval {
  weekday: number;
  startMin: number;
  endMin: number;
}

/** Mirrors the API's clockWheelSlot.ts expansion -- splits a midnight-wraparound slot
 * (endTime <= startTime) into the rest of the start weekday plus the start of the next. */
function parseTimeToMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function formatMinutes(min: number): string {
  const wrapped = ((min % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function expandToIntervals(slot: { weekdays: number[]; startTime: string; endTime: string }): Interval[] {
  const startMin = parseTimeToMinutes(slot.startTime);
  const endMin = parseTimeToMinutes(slot.endTime);

  const intervals: Interval[] = [];
  for (const weekday of slot.weekdays) {
    if (endMin > startMin) {
      intervals.push({ weekday, startMin, endMin });
    } else {
      intervals.push({ weekday, startMin, endMin: 24 * 60 });
      intervals.push({ weekday: (weekday + 1) % 7, startMin: 0, endMin });
    }
  }
  return intervals;
}

/** Visual weekly schedule: which clock wheel is active on which day/time. The default
 * wheel is drawn as each column's base fill (no blocks of its own) so gaps in the
 * specific wheels read as "default programming fills here" at a glance. */
export function ClockWheelWeekGrid({ wheels }: { wheels: ClockWheelDTO[] }) {
  const specificWheels = wheels
    .filter((wheel) => !wheel.isDefault && wheel.isActive && wheel.slots.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
  const defaultWheel = wheels.find((wheel) => wheel.isDefault);

  const colorFor = (index: number) => WHEEL_COLORS[index % WHEEL_COLORS.length]!;

  if (specificWheels.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
        No active clock wheel has a day/time window yet -- {defaultWheel?.name ?? "Default"} fills all 24/7.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex gap-2 pl-8">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="flex-1 text-center text-xs font-semibold uppercase tracking-wide text-slate-400">
            {label}
          </div>
        ))}
      </div>

      <div className="relative mt-2 flex gap-2 pl-8">
        {/* Hour gridlines + labels, absolutely positioned over the whole row of columns. */}
        <div className="pointer-events-none absolute inset-0 -left-8">
          {HOUR_MARKS.map((hour) => (
            <div
              key={hour}
              className="absolute left-0 right-0 border-t border-dashed border-slate-100"
              style={{ top: `${(hour / 24) * 100}%` }}
            >
              <span className="absolute -top-2 left-0 w-7 text-right text-[10px] tabular-nums text-slate-400">
                {String(hour).padStart(2, "0")}
              </span>
            </div>
          ))}
        </div>

        {WEEKDAY_LABELS.map((_, weekday) => (
          <div
            key={weekday}
            className="relative h-96 flex-1 overflow-hidden rounded-md bg-slate-100"
            title={`${WEEKDAY_LABELS[weekday]}: ${defaultWheel?.name ?? "Default"} unless noted`}
          >
            {specificWheels.map((wheel, index) =>
              wheel.slots.flatMap((slot) => expandToIntervals(slot)).map((interval, intervalIndex) =>
                interval.weekday === weekday ? (
                  <div
                    key={`${wheel.id}-${intervalIndex}`}
                    className="absolute inset-x-0"
                    style={{
                      top: `${(interval.startMin / 1440) * 100}%`,
                      height: `${((interval.endMin - interval.startMin) / 1440) * 100}%`,
                      backgroundColor: colorFor(index),
                    }}
                    title={`${wheel.name}: ${formatMinutes(interval.startMin)}–${formatMinutes(interval.endMin)}`}
                  />
                ) : null,
              ),
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3">
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="h-2.5 w-2.5 rounded-sm bg-slate-100" aria-hidden="true" />
          {defaultWheel?.name ?? "Default"} (fallback)
        </span>
        {specificWheels.map((wheel, index) => (
          <span key={wheel.id} className="flex items-center gap-1.5 text-xs text-slate-500">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: colorFor(index) }}
              aria-hidden="true"
            />
            {wheel.name}
          </span>
        ))}
      </div>
    </div>
  );
}
