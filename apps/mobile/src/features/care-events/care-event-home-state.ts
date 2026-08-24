import type { CareEvent, NapSession } from '@baby-tracker/domain';

import type { NursingHomeActionModel } from '@/features/nursing/nursing-home-state';
import type { SleepHomeActionModel } from '@/features/sleep/sleep-home-state';

export type CareEventHomeActionModel =
  | { kind: 'medicine'; label: 'Medicine'; meta: 'Add note' }
  | { kind: 'diaper'; label: 'Diaper'; meta: 'Log' };

export type HomeChronologyItem =
  | { kind: 'nap'; id: string; occurredAt: string; nap: NapSession }
  | { kind: 'care-event'; id: string; occurredAt: string; event: CareEvent };

/** Keeps Medicine and Diaper in Home slots four and five for every Sleep state. */
export function appendCareEventHomeActions(
  actions: readonly [SleepHomeActionModel, SleepHomeActionModel, NursingHomeActionModel],
): readonly [
  SleepHomeActionModel,
  SleepHomeActionModel,
  NursingHomeActionModel,
  CareEventHomeActionModel,
  CareEventHomeActionModel,
] {
  return [
    actions[0],
    actions[1],
    actions[2],
    { kind: 'medicine', label: 'Medicine', meta: 'Add note' },
    { kind: 'diaper', label: 'Diaper', meta: 'Log' },
  ];
}

/** Produces a deterministic newest-first Home chronology while retaining exact record IDs. */
export function homeChronology(
  naps: readonly NapSession[],
  careEvents: readonly CareEvent[],
): readonly HomeChronologyItem[] {
  return [
    ...naps.map(
      (nap): HomeChronologyItem => ({
        kind: 'nap',
        id: nap.id,
        occurredAt: nap.startedAt,
        nap,
      }),
    ),
    ...careEvents.map(
      (event): HomeChronologyItem => ({
        kind: 'care-event',
        id: event.id,
        occurredAt: event.occurredAt,
        event,
      }),
    ),
  ].sort(
    (left, right) =>
      right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id),
  );
}
