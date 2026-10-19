import {
  createUnanchoredDayCycle,
  projectCycle,
  type Cycle,
  type CycleRecord,
  type DayCycle,
  type NightCycle,
} from '@baby-tracker/domain';
import { calendarDayForInstant } from '@/features/naps/calendar-day';
import {
  projectedView,
  type RadialActivityRecord,
  type RadialCycleView,
} from '@/features/timeline/radial-cycle-state';
import { nursingTimes } from './nursing';
import { activityDuration, byStart, sleepBoundaryAt, sleepContext } from './sleep-state';
import type { CareActivity, PointActivity } from './contracts';

/** Provider-neutral projection. Anchors retain the IDs of the exact editable source activities. */
export function careCycleViews(
  activities: readonly CareActivity[],
  date: string,
  timezone: string,
  now: Date,
  showCurrent: boolean,
): { day: RadialCycleView; night: RadialCycleView } {
  const boundaries = activities
    .filter((a): a is PointActivity => a.kind === 'bedtime' || a.kind === 'wake-up')
    .sort(byStart);
  const context = sleepContext(activities);
  const wake = [...boundaries]
    .reverse()
    .find(
      (a) =>
        a.kind === 'wake-up' &&
        (calendarDayForInstant(new Date(a.startedAt), timezone) === date ||
          (showCurrent && context.night && a.startedAt < context.night.startedAt)),
    );
  const nextBed = wake
    ? boundaries.find((a) => a.kind === 'bedtime' && a.startedAt > wake.startedAt)
    : undefined;
  const dayCycle: Cycle = wake
    ? ({
        id: `day:${wake.id}`,
        identity: { kind: 'day', precedingNightSessionId: wake.id, wakeUpAt: wake.startedAt },
        kind: 'day',
        precedingNightSessionId: wake.id,
        nextNightSessionId: nextBed?.id ?? null,
        startedAt: wake.startedAt,
        endedAt: nextBed ? sleepBoundaryAt(nextBed) : null,
        timezone,
        startAnchor: { kind: 'wake_up', recordId: wake.id, at: wake.startedAt },
        endAnchor: nextBed
          ? { kind: 'bedtime', recordId: nextBed.id, at: sleepBoundaryAt(nextBed) }
          : null,
      } satisfies DayCycle)
    : createUnanchoredDayCycle(date, timezone);
  const bed =
    showCurrent && context.night
      ? context.night
      : ([...boundaries]
          .reverse()
          .find(
            (a) =>
              a.kind === 'bedtime' &&
              calendarDayForInstant(new Date(a.startedAt), timezone) === date,
          ) ??
        (wake
          ? [...boundaries]
              .reverse()
              .find((a) => a.kind === 'bedtime' && a.startedAt < wake.startedAt)
          : undefined));
  const afterBed = bed ? boundaries.find((a) => a.startedAt > bed.startedAt) : undefined;
  const end = afterBed?.kind === 'wake-up' ? afterBed : undefined;
  const nightCycle: NightCycle | null =
    bed && (!afterBed || end)
      ? {
          id: `night:${bed.id}`,
          identity: { kind: 'night', nightSessionId: bed.id },
          kind: 'night',
          sourceNightSessionId: bed.id,
          startedAt: sleepBoundaryAt(bed),
          endedAt: end?.startedAt ?? null,
          timezone,
          startAnchor: { kind: 'bedtime', recordId: bed.id, at: sleepBoundaryAt(bed) },
          endAnchor: end ? { kind: 'wake_up', recordId: end.id, at: end.startedAt } : null,
        }
      : null;
  const records: CycleRecord[] = [];
  const metadata = new Map<string, RadialActivityRecord>();
  for (const a of activities) {
    if (a.kind === 'bedtime' || a.kind === 'wake-up') continue;
    const point =
      a.kind === 'diaper' ||
      a.kind === 'medicine' ||
      (a.status === 'completed' && a.endedAt === a.startedAt);
    records.push(
      point
        ? { type: 'point', id: a.id, lane: 'point', occurredAt: a.startedAt }
        : {
            type: 'interval',
            id: a.id,
            lane: a.kind === 'nap' ? 'outer' : 'inner',
            startedAt: a.startedAt,
            endedAt: a.endedAt,
          },
    );
    metadata.set(a.id, {
      id: a.id,
      editorRecordId: a.id,
      kind: a.kind,
      occurredAt: a.startedAt,
      endedAt: point ? null : a.endedAt,
      status: a.status,
      ...(a.kind === 'nursing'
        ? { durationMs: nursingTimes(a, now).total * 1000 }
        : a.kind === 'nap' || a.kind === 'night-waking'
          ? { durationMs: activityDuration(a, now) }
          : {}),
      diaperType: a.kind === 'diaper' ? (a.diaperType ?? null) : null,
    });
  }
  if (nightCycle && bed) {
    records.push({
      type: 'interval',
      id: bed.id,
      lane: 'outer',
      startedAt: sleepBoundaryAt(bed),
      endedAt: end?.startedAt ?? null,
    });
    metadata.set(bed.id, {
      id: bed.id,
      editorRecordId: bed.id,
      kind: 'night',
      occurredAt: sleepBoundaryAt(bed),
      endedAt: end?.startedAt ?? null,
      status: end ? 'completed' : 'active',
      diaperType: null,
    });
  }
  return {
    day: projectedView('day', projectCycle(dayCycle, records, { now }), metadata),
    night: nightCycle
      ? projectedView('night', projectCycle(nightCycle, records, { now }), metadata)
      : {
          kind: 'night',
          emptyLabel: 'No night sleep logged',
          projection: null,
          records: [],
          ticks: [],
        },
  };
}
