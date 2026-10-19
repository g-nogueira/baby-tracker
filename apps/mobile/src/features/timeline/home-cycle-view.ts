import {
  calendarDayForInstant,
  instantForZonedDateTime,
  shiftCalendarDay,
} from '@/features/naps/calendar-day';
import type { RadialCycleView } from './radial-cycle-state';
import { HISTORY_START_ANGLE, HISTORY_SWEEP_ANGLE } from './history-dial-state';

/** Presentation-only estimates never become recorded boundaries or editor targets. */
export function homeCycleView(view: RadialCycleView): RadialCycleView {
  const projection = view.projection;
  if (!projection) return view;
  const start = Date.parse(projection.cycle.startedAt);
  const observed = Date.parse(projection.observedEndedAt) - start;
  let estimate: string | null = null;
  if (view.kind === 'night' && projection.cycle.endedAt === null) {
    let date = calendarDayForInstant(new Date(start), projection.cycle.timezone);
    const morning = (day: string) => {
      const [year, month, date] = day.split('-').map(Number);
      return instantForZonedDateTime(
        { year, month, day: date, hour: 7, minute: 0, second: 0 },
        projection.cycle.timezone,
      );
    };
    if (morning(date).getTime() <= start) date = shiftCalendarDay(date, 1);
    estimate = morning(date).toISOString();
  }
  const horizon =
    projection.cycle.kind === 'unanchored_day'
      ? 24 * 3600000
      : projection.cycle.endedAt !== null
        ? Math.max(1, observed)
        : Math.max(estimate ? Date.parse(estimate) - start : 14 * 3600000, observed, 1);
  const angle = (ms: number) =>
    HISTORY_START_ANGLE + Math.min(1, Math.max(0, ms / horizon)) * HISTORY_SWEEP_ANGLE;
  const position = <T extends { elapsedMs: number; angleDegrees: number }>(p: T): T => ({
    ...p,
    angleDegrees: angle(p.elapsedMs),
  });
  const records = view.records.map((record) => ({
    ...record,
    projection: {
      ...record.projection,
      token: record.projection.token
        ? { ...record.projection.token, projection: position(record.projection.token.projection) }
        : null,
      arc: record.projection.arc
        ? {
            ...record.projection.arc,
            start: position(record.projection.arc.start),
            end: position(record.projection.arc.end),
          }
        : null,
    },
  }));
  return {
    ...view,
    records,
    estimatedWakeUp: estimate
      ? { at: estimate, angleDegrees: angle(Date.parse(estimate) - start), source: 'fixed-7am' }
      : undefined,
    nightProgress:
      view.kind === 'night'
        ? { startAngle: HISTORY_START_ANGLE, endAngle: angle(observed) }
        : undefined,
    ticks: view.ticks
      .filter((tick) => tick.offsetMs <= horizon)
      .map((tick) => ({ ...tick, angleDegrees: angle(tick.offsetMs) })),
    projection: {
      ...projection,
      records: records.map((r) => r.projection),
      anchors: projection.anchors.map((a) => ({ ...a, projection: position(a.projection) })),
    },
  };
}
