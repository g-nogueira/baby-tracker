import {
  createDiaperEvent,
  createMedicineEvent,
  type MutationContext,
  startNap,
  startNightSleep,
  startNightWaking,
} from '@baby-tracker/domain';
import { describe, expect, it } from 'vitest';

import { appendNursingHomeAction, deriveNursingHomeModel } from '../nursing/nursing-home-state';
import { deriveSleepHomeModel } from '../sleep/sleep-home-state';
import { appendCareEventHomeActions, homeChronology } from './care-event-home-state';

describe('CareEvent Home state', () => {
  it.each(['awake', 'nap-active', 'night-asleep', 'night-awake'] as const)(
    'keeps Medicine and Diaper in slots four and five while Sleep is %s',
    (sleepState) => {
      const sleep =
        sleepState === 'awake'
          ? null
          : sleepState === 'nap-active'
            ? startNap(context('2026-08-15T10:00:00.000Z')).session
            : sleepState === 'night-asleep'
              ? startNightSleep(context('2026-08-15T20:00:00.000Z')).session
              : startNightWaking(
                  startNightSleep(context('2026-08-15T20:00:00.000Z')).session,
                  context('2026-08-15T22:00:00.000Z'),
                ).session;
      const sleepModel = deriveSleepHomeModel(sleep, null);
      const nursing = deriveNursingHomeModel(null, null, new Date()).action;

      expect(
        appendCareEventHomeActions(appendNursingHomeAction(sleepModel.actions, nursing)).map(
          ({ kind }) => kind,
        ),
      ).toEqual([
        sleepModel.actions[0].kind,
        sleepModel.actions[1].kind,
        'nursing',
        'medicine',
        'diaper',
      ]);
    },
  );

  it('merges point events and Naps newest-first with deterministic ID ties', () => {
    const nap = startNap(
      contextWithIds('2026-08-15T10:00:00.000Z', ['nap', 'phase', 'nap-op']),
    ).session;
    const medicine = createMedicineEvent(
      'private',
      contextWithIds('2026-08-15T11:00:00.000Z', ['medicine-a', 'medicine-op']),
    ).event;
    const diaper = createDiaperEvent(
      'wet',
      contextWithIds('2026-08-15T11:00:00.000Z', ['diaper-z', 'diaper-op']),
    ).event;

    expect(homeChronology([nap], [medicine, diaper]).map(({ id }) => id)).toEqual([
      'medicine-a',
      'diaper-z',
      'nap',
    ]);
  });
});

function context(at: string): MutationContext {
  return contextWithIds(at, [`${at}-id-0`, `${at}-id-1`, `${at}-id-2`]);
}

function contextWithIds(at: string, ids: string[]): MutationContext {
  let sequence = 0;
  return {
    caregiverId: 'caregiver-paloma',
    childId: 'child-arthur',
    now: new Date(at),
    timezone: 'Europe/Lisbon',
    newId: () => ids[sequence++] ?? `${at}-unexpected-${sequence}`,
  };
}
