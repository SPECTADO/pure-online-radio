import { useEffect, useState } from "react";
import { usePopover } from "../lib/usePopover";
import { useTimeFormat } from "../lib/useTimeFormat";
import { toDatetimeLocalValue } from "../lib/format";
import { formatTimeValue, parseTimeValue } from "../lib/timeValue";
import { getCalendarMonthGrid, isSameDay } from "../lib/calendarGrid";
import { TimeSpinner } from "./TimeSpinner";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const triggerClass =
  "flex w-full items-center justify-between gap-2 rounded-md border border-slate-300 px-3 py-2 text-left text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
const navButtonClass = "rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700";

const DATETIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function parseValue(value: string) {
  const match = DATETIME_LOCAL_PATTERN.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  return { year: Number(y), month: Number(mo) - 1, day: Number(d), hour: Number(h), minute: Number(mi) };
}

function buildValue(year: number, month: number, day: number, hour: number, minute: number): string {
  return toDatetimeLocalValue(new Date(year, month, day, hour, minute).toISOString());
}

/** Custom date + time picker -- replaces the browser's native
 * `<input type="datetime-local">`, whose calendar/keyboard UI differs enough
 * across browsers (and is unstyleable) to cause the reported picker issues.
 * Value/onChange keep the exact same "YYYY-MM-DDTHH:mm" local-value string
 * contract `lib/format.ts`'s toDatetimeLocalValue/fromDatetimeLocalValue already
 * use, so call sites only need to swap the element itself. */
export function DateTimePicker({
  value,
  onChange,
  className,
  placeholder = "Select date & time",
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const timeFormat = useTimeFormat();
  const { isOpen, setIsOpen, ref } = usePopover<HTMLDivElement>();
  const parsed = parseValue(value);
  const [viewYear, setViewYear] = useState(parsed?.year ?? new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.month ?? new Date().getMonth());

  // Jump the visible month back to the selected date whenever the value changes
  // from outside this popover (e.g. a fresh modal opening with an existing value).
  useEffect(() => {
    if (parsed) {
      setViewYear(parsed.year);
      setViewMonth(parsed.month);
    }
  }, [value]);

  const selectedDate = parsed ? new Date(parsed.year, parsed.month, parsed.day) : null;
  const timeValue = parsed ? formatTimeValue(parsed.hour, parsed.minute) : "";

  function commitDate(date: Date) {
    const now = new Date();
    const hour = parsed?.hour ?? now.getHours();
    const minute = parsed?.minute ?? now.getMinutes();
    onChange(buildValue(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute));
  }

  function commitTime(next: string) {
    const base = selectedDate ?? new Date();
    const { hour, minute } = parseTimeValue(next);
    onChange(buildValue(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute));
  }

  function goToMonth(delta: number) {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  function setNow() {
    const now = new Date();
    onChange(buildValue(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()));
  }

  const grid = getCalendarMonthGrid(viewYear, viewMonth);
  const today = new Date();

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button type="button" onClick={() => setIsOpen((v) => !v)} className={triggerClass}>
        <span className={value ? "" : "text-slate-400"}>
          {value
            ? new Date(value).toLocaleString([], {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
                hour12: timeFormat === "12h",
              })
            : placeholder}
        </span>
        <span aria-hidden className="text-slate-400">
          ▾
        </span>
      </button>

      {isOpen && (
        <div className="absolute z-20 mt-1 w-72 rounded-md border border-slate-200 bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => goToMonth(-1)} aria-label="Previous month" className={navButtonClass}>
              ◂
            </button>
            <span className="text-sm font-medium text-slate-900">
              {new Date(viewYear, viewMonth, 1).toLocaleDateString([], { month: "long", year: "numeric" })}
            </span>
            <button type="button" onClick={() => goToMonth(1)} aria-label="Next month" className={navButtonClass}>
              ▸
            </button>
          </div>

          <div className="grid grid-cols-7 text-center text-xs text-slate-400">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="py-1">
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {grid.map(({ date, inCurrentMonth }) => {
              const isSelected = selectedDate !== null && isSameDay(date, selectedDate);
              const isToday = isSameDay(date, today);
              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  onClick={() => commitDate(date)}
                  className={`rounded-md py-1.5 text-sm ${
                    isSelected
                      ? "bg-slate-900 text-white"
                      : isToday
                        ? "font-semibold text-slate-900 hover:bg-slate-100"
                        : inCurrentMonth
                          ? "text-slate-700 hover:bg-slate-100"
                          : "text-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-3 border-t border-slate-100 pt-3">
            <TimeSpinner value={timeValue || "00:00"} onChange={commitTime} timeFormat={timeFormat} />
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
            <button type="button" onClick={() => onChange("")} className="text-xs font-medium text-slate-400 hover:text-slate-600">
              Clear
            </button>
            <button type="button" onClick={setNow} className="text-xs font-medium text-slate-500 hover:text-slate-700">
              Now
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-xs font-medium text-slate-900 hover:underline"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
