import type { NightSleepSession } from '@baby-tracker/domain';
import { describe, expect, it } from 'vitest';

import {
  activeNightDurationStartedAt,
  adjustNightTransitionTime,
  createNightTransitionDraft,
  nightTransitionDraftForSave,
  nightTransitionError,
  updateNightTransitionTime,
} from './night-transition-drawer-state';

describe('Night transition drawer state', () => {
  const openedAt = new Date('2026-08-15T00:30:00.000Z');

  it('requires a containing session for phase transitions', () => {
    expect(() => createNightTransitionDraft('start-night-waking', null, openedAt)).toThrow(
      'active Night session',
    );
    expect(createNightTransitionDraft('start-night-sleep', null, openedAt)).toMatchObject({
      effectiveAt: openedAt,
    });
  });

  it('keeps the displayed transition instant authoritative when primary is pressed later', () => {
    const draft = createNightTransitionDraft('end-night-sleep', night(), openedAt);
    expect(nightTransitionDraftForSave(draft)).toBe(draft);
    expect(nightTransitionDraftForSave(draft).effectiveAt).toEqual(openedAt);
    expect(
      updateNightTransitionTime(draft, new Date('2026-08-15T00:28:00.000Z')).effectiveAt,
    ).toEqual(new Date('2026-08-15T00:28:00.000Z'));
  });

  it('uses the containing session for asleep duration and the open phase for awake duration', () => {
    expect(activeNightDurationStartedAt(night())).toBe('2026-08-15T00:20:00.000Z');
    const awake = night();
    const asleepPhase = awake.phases[0];
    if (asleepPhase === undefined) throw new Error('Expected an asleep phase.');
    awake.phases = [
      { ...asleepPhase, endedAt: '2026-08-15T00:25:00.000Z' },
      {
        ...asleepPhase,
        id: 'awake-phase',
        kind: 'awake',
        startedAt: '2026-08-15T00:25:00.000Z',
      },
    ];
    expect(activeNightDurationStartedAt(awake)).toBe('2026-08-15T00:25:00.000Z');
  });

  it('omits live duration for a stale session without an open phase', () => {
    const completed = night();
    completed.status = 'completed';
    completed.endedAt = '2026-08-15T00:30:00.000Z';
    const phase = completed.phases[0];
    if (phase === undefined) throw new Error('Expected an asleep phase.');
    completed.phases = [{ ...phase, endedAt: completed.endedAt }];

    expect(activeNightDurationStartedAt(completed)).toBeNull();
    expect(
      nightTransitionError(createNightTransitionDraft('end-night-sleep', completed, openedAt)),
    ).toBe('The active Night phase could not be found.');
  });

  it('adjusts by a minute without moving into the future', () => {
    const draft = createNightTransitionDraft('start-night-sleep', null, openedAt);
    expect(
      adjustNightTransitionTime(draft, 1, new Date('2026-08-15T00:30:30.000Z')).effectiveAt,
    ).toEqual(new Date('2026-08-15T00:30:30.000Z'));
    expect(adjustNightTransitionTime(draft, -1, openedAt).effectiveAt).toEqual(
      new Date('2026-08-15T00:29:00.000Z'),
    );
  });

  it('rejects future and non-increasing phase transitions', () => {
    const draft = createNightTransitionDraft('end-night-sleep', night(), openedAt);
    expect(
      nightTransitionError(
        updateNightTransitionTime(draft, new Date('2026-08-15T00:31:00.000Z')),
        openedAt,
      ),
    ).toBe('Night transition time cannot be in the future.');
    expect(
      nightTransitionError(
        updateNightTransitionTime(draft, new Date('2026-08-15T00:20:00.000Z')),
        openedAt,
      ),
    ).toBe('Transition time must be after the current phase started.');
  });
});

function night(): NightSleepSession {
  return {
    id: 'night',
    childId: 'child',
    kind: 'night',
    startedAt: '2026-08-15T00:20:00.000Z',
    endedAt: null,
    status: 'active',
    timezone: 'Europe/Lisbon',
    createdBy: 'caregiver',
    updatedBy: 'caregiver',
    version: 2,
    deletedAt: null,
    phases: [
      {
        id: 'phase',
        sleepSessionId: 'night',
        kind: 'asleep',
        startedAt: '2026-08-15T00:20:00.000Z',
        endedAt: null,
        createdBy: 'caregiver',
        updatedBy: 'caregiver',
        version: 1,
        deletedAt: null,
      },
    ],
  };
}
