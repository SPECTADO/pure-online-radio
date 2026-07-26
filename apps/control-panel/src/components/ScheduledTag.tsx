/** Small dashed-border tag marking a Dashboard/Queue row as schedule-originated (a fired
 * ScheduleRule block, or a not-yet-fired ScheduleRule/ExternalStream preview). */
export function ScheduledTag({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
      {label}
    </span>
  );
}
