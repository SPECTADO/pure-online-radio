import { usePopover } from "../lib/usePopover";
import { useTimeFormat } from "../lib/useTimeFormat";
import { formatTimeDisplay, formatTimeValue } from "../lib/timeValue";
import { TimeSpinner } from "./TimeSpinner";

const triggerClass =
  "flex w-full items-center justify-between gap-2 rounded-md border border-slate-300 px-3 py-2 text-left text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

/** Custom "HH:mm" time picker -- replaces the browser's native `<input type="time">`,
 * whose spinner UI/keyboard behavior differs enough across browsers to cause the
 * reported picker issues. Value/onChange keep the exact same "HH:mm" string contract
 * the native input had, so call sites only need to swap the element itself. */
export function TimePicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const timeFormat = useTimeFormat();
  const { isOpen, setIsOpen, ref } = usePopover<HTMLDivElement>();

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button type="button" onClick={() => setIsOpen((v) => !v)} className={triggerClass}>
        <span>{value ? formatTimeDisplay(value, timeFormat) : "Select time"}</span>
        <span aria-hidden className="text-slate-400">
          ▾
        </span>
      </button>

      {isOpen && (
        <div className="absolute z-20 mt-1 rounded-md border border-slate-200 bg-white p-3 shadow-lg">
          <TimeSpinner value={value || "00:00"} onChange={onChange} timeFormat={timeFormat} />
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              onChange(formatTimeValue(now.getHours(), now.getMinutes()));
            }}
            className="mt-2 w-full rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50"
          >
            Now
          </button>
        </div>
      )}
    </div>
  );
}
