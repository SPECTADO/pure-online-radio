import { useEffect, useState } from "react";
import type { TimeFormat } from "@spectado/shared-types";
import { clampWrap, formatTimeValue, parseTimeValue } from "../lib/timeValue";

const stepperButtonClass = "flex h-4 w-8 items-center justify-center text-xs text-slate-400 hover:text-slate-700";
const segmentInputClass =
  "w-10 rounded-md border border-slate-300 py-1 text-center text-lg font-medium tabular-nums focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
const meridiemButtonClass = (active: boolean) =>
  `px-2 py-1 text-xs font-medium ${active ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`;

function SpinnerSegment({
  value,
  min,
  max,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (next: number) => void;
}) {
  const format = (n: number) => String(n).padStart(2, "0");
  const [draft, setDraft] = useState(format(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(format(value));
  }, [value, focused]);

  function commitDraft(raw: string) {
    const parsed = Number.parseInt(raw, 10);
    const next = Number.isFinite(parsed) ? clampWrap(parsed, min, max) : value;
    onCommit(next);
    setDraft(format(next));
  }

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Increase"
        onClick={() => onCommit(clampWrap(value + 1, min, max))}
        className={stepperButtonClass}
      >
        ▲
      </button>
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 2))}
        onBlur={(e) => {
          setFocused(false);
          commitDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commitDraft(draft);
            e.currentTarget.blur();
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            onCommit(clampWrap(value + 1, min, max));
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            onCommit(clampWrap(value - 1, min, max));
          }
        }}
        className={segmentInputClass}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Decrease"
        onClick={() => onCommit(clampWrap(value - 1, min, max))}
        className={stepperButtonClass}
      >
        ▼
      </button>
    </div>
  );
}

/** Hour/minute steppers + (for 12h stations) an AM/PM toggle -- the input surface
 * shared by TimePicker and the time half of DateTimePicker. Always operates on
 * "HH:mm" 24h values; only the displayed hour respects `timeFormat`. */
export function TimeSpinner({
  value,
  onChange,
  timeFormat,
}: {
  value: string;
  onChange: (value: string) => void;
  timeFormat: TimeFormat;
}) {
  const { hour, minute } = parseTimeValue(value);
  const is12h = timeFormat === "12h";
  const isPm = hour >= 12;
  const displayHour = is12h ? ((hour + 11) % 12) + 1 : hour;

  function commitDisplayHour(next: number) {
    const hour24 = is12h ? (next % 12) + (isPm ? 12 : 0) : next;
    onChange(formatTimeValue(hour24, minute));
  }

  function commitMinute(next: number) {
    onChange(formatTimeValue(hour, next));
  }

  function setMeridiem(pm: boolean) {
    if (pm === isPm) return;
    onChange(formatTimeValue((hour + 12) % 24, minute));
  }

  return (
    <div className="flex items-center justify-center gap-1">
      <SpinnerSegment value={displayHour} min={is12h ? 1 : 0} max={is12h ? 12 : 23} onCommit={commitDisplayHour} />
      <span className="pb-4 text-lg font-medium text-slate-400">:</span>
      <SpinnerSegment value={minute} min={0} max={59} onCommit={commitMinute} />
      {is12h && (
        <div className="ml-2 flex flex-col overflow-hidden rounded-md border border-slate-300">
          <button type="button" onClick={() => setMeridiem(false)} className={meridiemButtonClass(!isPm)}>
            AM
          </button>
          <button type="button" onClick={() => setMeridiem(true)} className={meridiemButtonClass(isPm)}>
            PM
          </button>
        </div>
      )}
    </div>
  );
}
