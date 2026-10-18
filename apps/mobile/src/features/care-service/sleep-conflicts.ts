import { byStart } from './sleep-state';
import type { CareActivity } from './contracts';

export interface SleepConflict {
  key: string;
  rule: string;
  ids: string[];
  message: string;
}
/** Diagnose known sleep conflicts; an absent historical bedtime alone may reflect a bounded read. */
export function sleepConflicts(records: readonly CareActivity[]): SleepConflict[] {
  const violations: SleepConflict[] = [];
  const add = (rule: string, message: string, activities: CareActivity[]) => {
    const ids = activities.map((a) => a.id).sort();
    violations.push({ key: JSON.stringify([rule, ids]), rule, ids, message });
  };
  const boundaries = records
    .filter((r) => r.kind === 'bedtime' || r.kind === 'wake-up')
    .sort(byStart);
  for (let i = 1; i < boundaries.length; i++)
    if (
      boundaries[i].kind === boundaries[i - 1].kind ||
      boundaries[i].startedAt === boundaries[i - 1].startedAt
    )
      add(
        'boundaries',
        'Bedtime and Wake up must alternate in time. Review the neighboring night boundaries.',
        [boundaries[i - 1], boundaries[i]],
      );
  const naps = records.filter((r) => r.kind === 'nap');
  const wakings = records.filter((r) => r.kind === 'night-waking');
  for (const nap of naps)
    for (const waking of wakings)
      if (
        (!nap.endedAt || waking.startedAt < nap.endedAt) &&
        (!waking.endedAt || nap.startedAt < waking.endedAt)
      )
        add('nap-waking-overlap', 'A nap cannot overlap a night waking.', [nap, waking]);
  for (const intervals of [naps, wakings]) {
    const sorted = intervals.sort(byStart);
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length; j++) {
        const end = sorted[i].endedAt;
        if (!end || end > sorted[j].startedAt)
          add('overlap', 'This time overlaps another activity of the same type.', [
            sorted[i],
            sorted[j],
          ]);
      }
  }
  for (const interval of [...naps, ...wakings]) {
    if (interval.endedAt && interval.endedAt <= interval.startedAt)
      add('duration', 'End must be after Start.', [interval]);
    const preceding = [...boundaries].reverse().find((b) => b.startedAt <= interval.startedAt);
    const next = boundaries.find((b) => b.startedAt > interval.startedAt);
    if (interval.kind === 'night-waking') {
      if (preceding?.kind !== 'bedtime' || interval.startedAt <= preceding.startedAt)
        add('waking-start', 'A night waking must start after its bedtime.', [
          interval,
          ...(preceding ? [preceding] : []),
        ]);
      if (next && (!interval.endedAt || interval.endedAt > next.startedAt))
        add('waking-end', 'A night waking must finish by the morning Wake up.', [interval, next]);
    } else if (preceding?.kind === 'bedtime') {
      add('nap-night-start', 'A nap cannot overlap a night sleep.', [interval, preceding]);
    } else if (
      next?.kind === 'bedtime' &&
      (!interval.endedAt || interval.endedAt > next.startedAt)
    ) {
      add('nap-night-end', 'A nap cannot overlap a night sleep.', [interval, next]);
    }
  }
  return violations;
}
