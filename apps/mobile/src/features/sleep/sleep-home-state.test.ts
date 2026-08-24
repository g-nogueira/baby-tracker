import type { NapSession, NightSleepSession } from '@baby-tracker/domain';
import { describe, expect, it } from 'vitest';

import { deriveSleepHomeModel } from './sleep-home-state';

describe('Sleep Home state', () => {
  it('projects the awake action row with and without prior Sleep history', () => {
    expect(deriveSleepHomeModel(null, null)).toMatchObject({
      state: 'awake',
      actions: [{ kind: 'start-night-sleep' }, { kind: 'start-nap' }],
      center: { label: 'Awake', durationStartedAt: null },
      controller: null,
    });
    expect(deriveSleepHomeModel(null, '2026-08-15T07:00:00.000Z').center).toMatchObject({
      label: 'Awake for',
      durationStartedAt: '2026-08-15T07:00:00.000Z',
    });
  });

  it('keeps Current Nap available and explains why Night sleep is disabled', () => {
    const model = deriveSleepHomeModel(nap(), null);
    expect(model).toMatchObject({
      state: 'nap-active',
      actions: [
        { kind: 'start-night-sleep', disabledReason: expect.stringContaining('nap is active') },
        { kind: 'open-current-nap', disabledReason: null },
      ],
      center: { durationStartedAt: '2026-08-15T10:00:00.000Z' },
      controller: { kind: 'nap', durationStartedAt: '2026-08-15T10:00:00.000Z' },
    });
  });

  it('uses the open asleep phase for the centre and the containing Night for the controller', () => {
    const model = deriveSleepHomeModel(night('asleep'), null);
    expect(model).toMatchObject({
      state: 'night-asleep',
      actions: [{ kind: 'end-night-sleep' }, { kind: 'start-night-waking' }],
      center: { label: 'Asleep for', durationStartedAt: '2026-08-15T00:20:00.000Z' },
      controller: {
        kind: 'night-asleep',
        durationStartedAt: '2026-08-14T20:00:00.000Z',
      },
    });
  });

  it('offers Wake up and Fell asleep again during an awake Night phase', () => {
    const model = deriveSleepHomeModel(night('awake'), null);
    expect(model).toMatchObject({
      state: 'night-awake',
      actions: [{ kind: 'end-night-sleep' }, { kind: 'resume-night-sleep' }],
      center: { label: 'Awake tonight', durationStartedAt: '2026-08-15T00:20:00.000Z' },
      controller: {
        kind: 'night-awake',
        durationStartedAt: '2026-08-15T00:20:00.000Z',
      },
    });
  });
});

function nap(): NapSession {
  return {
    id: 'nap',
    childId: 'child',
    kind: 'nap',
    startedAt: '2026-08-15T10:00:00.000Z',
    endedAt: null,
    status: 'active',
    timezone: 'Europe/Lisbon',
    createdBy: 'caregiver',
    updatedBy: 'caregiver',
    version: 1,
    deletedAt: null,
    phases: [phase('nap-phase', 'nap', 'asleep', '2026-08-15T10:00:00.000Z')],
  };
}

function night(openKind: 'asleep' | 'awake'): NightSleepSession {
  const phases =
    openKind === 'awake'
      ? [
          phase(
            'phase-1',
            'night',
            'asleep',
            '2026-08-14T20:00:00.000Z',
            '2026-08-15T00:20:00.000Z',
          ),
          phase('phase-2', 'night', 'awake', '2026-08-15T00:20:00.000Z'),
        ]
      : [
          phase(
            'phase-1',
            'night',
            'asleep',
            '2026-08-14T20:00:00.000Z',
            '2026-08-14T23:50:00.000Z',
          ),
          phase(
            'phase-2',
            'night',
            'awake',
            '2026-08-14T23:50:00.000Z',
            '2026-08-15T00:20:00.000Z',
          ),
          phase('phase-3', 'night', 'asleep', '2026-08-15T00:20:00.000Z'),
        ];
  return {
    id: 'night',
    childId: 'child',
    kind: 'night',
    startedAt: '2026-08-14T20:00:00.000Z',
    endedAt: null,
    status: 'active',
    timezone: 'Europe/Lisbon',
    createdBy: 'caregiver',
    updatedBy: 'caregiver',
    version: 3,
    deletedAt: null,
    phases,
  };
}

function phase(
  id: string,
  sessionId: string,
  kind: 'asleep' | 'awake',
  startedAt: string,
  endedAt: string | null = null,
) {
  return {
    id,
    sleepSessionId: sessionId,
    kind,
    startedAt,
    endedAt,
    createdBy: 'caregiver',
    updatedBy: 'caregiver',
    version: 1,
    deletedAt: null,
  };
}
