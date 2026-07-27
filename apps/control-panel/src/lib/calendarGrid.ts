export interface CalendarDay {
  date: Date;
  inCurrentMonth: boolean;
}

/** 6-row (42-day) calendar grid for `year`/`month` (0-indexed), weeks starting Sunday --
 * includes the leading/trailing days from adjacent months needed to fill the grid. */
export function getCalendarMonthGrid(year: number, month: number): CalendarDay[] {
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());

  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    return { date, inCurrentMonth: date.getMonth() === month };
  });
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
