/** A ClockWheelSlot's scalar fields, in Prisma's on-the-wire shape -- startTime/endTime are
 * `@db.Time()` values (a JS Date at the 1970-01-01 UTC epoch, wall-clock time only), same
 * convention as ScheduleRule/ExternalStream's trigger fields (see lib/scheduleTrigger.ts). */
export interface ClockWheelSlotTime {
  weekdays: number[]; // 0=Sun..6=Sat
  startTime: Date;
  endTime: Date;
}

function utcMinutesSinceMidnight(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Expands a slot into concrete per-weekday [startMin, endMin) intervals. Handles
 * midnight-wraparound slots (endTime <= startTime, e.g. a 22:00-06:00 night show) by
 * splitting into two intervals: the rest of the start weekday, then the start of the
 * next weekday. */
function expandToDayIntervals(
  slot: ClockWheelSlotTime,
): Array<{ weekday: number; startMin: number; endMin: number }> {
  const startMin = utcMinutesSinceMidnight(slot.startTime);
  const endMin = utcMinutesSinceMidnight(slot.endTime);
  const intervals: Array<{ weekday: number; startMin: number; endMin: number }> = [];

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

/** Is `slot` active at `at` (matched by `at`'s UTC weekday + wall-clock minutes)? */
export function isSlotActiveAt(slot: ClockWheelSlotTime, at: Date): boolean {
  const weekday = at.getUTCDay();
  const minutes = at.getUTCHours() * 60 + at.getUTCMinutes();
  return expandToDayIntervals(slot).some((i) => i.weekday === weekday && minutes >= i.startMin && minutes < i.endMin);
}

/** Do two slots (typically from two different wheels) overlap on any shared weekday?
 * Used to reject overlapping slots between active, non-default wheels at create/edit
 * time so a given moment never matches more than one non-default wheel. */
export function slotsOverlap(a: ClockWheelSlotTime, b: ClockWheelSlotTime): boolean {
  const aIntervals = expandToDayIntervals(a);
  const bIntervals = expandToDayIntervals(b);
  return aIntervals.some((ai) =>
    bIntervals.some((bi) => ai.weekday === bi.weekday && ai.startMin < bi.endMin && bi.startMin < ai.endMin),
  );
}
