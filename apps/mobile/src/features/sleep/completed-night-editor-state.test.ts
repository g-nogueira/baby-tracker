import type { NightSleepSession } from '@baby-tracker/domain';
import { describe, expect, it } from 'vitest';

import {
  completedNightBoundariesForSave,
  completedNightEditorError,
  createCompletedNightEditorState,
  updateCompletedNightBoundary,
} from './completed-night-editor-state';

const session: NightSleepSession = {
  id: 'night-1',
  childId: 'child-1',
  kind: 'night',
  startedAt: '2026-08-15T20:00:00.000Z',
  endedAt: '2026-08-16T06:00:00.000Z',
  status: 'completed',
  timezone: 'Europe/Lisbon',
  createdBy: 'caregiver',
  updatedBy: 'caregiver',
  version: 3,
  deletedAt: null,
  phases: [
    {
      id: 'asleep',
      sleepSessionId: 'night-1',
      kind: 'asleep',
      startedAt: '2026-08-15T20:00:00.000Z',
      endedAt: '2026-08-16T01:00:00.000Z',
      createdBy: 'caregiver',
      updatedBy: 'caregiver',
      version: 2,
      deletedAt: null,
    },
    {
      id: 'awake',
      sleepSessionId: 'night-1',
      kind: 'awake',
      startedAt: '2026-08-16T01:00:00.000Z',
      endedAt: '2026-08-16T01:20:00.000Z',
      createdBy: 'caregiver',
      updatedBy: 'caregiver',
      version: 2,
      deletedAt: null,
    },
    {
      id: 'asleep-again',
      sleepSessionId: 'night-1',
      kind: 'asleep',
      startedAt: '2026-08-16T01:20:00.000Z',
      endedAt: '2026-08-16T06:00:00.000Z',
      createdBy: 'caregiver',
      updatedBy: 'caregiver',
      version: 2,
      deletedAt: null,
    },
  ],
};

describe('completed Night editor state', () => {
  it('changes only Bedtime and Wake up while retaining every transition identity', () => {
    const initial = createCompletedNightEditorState(session);
    const bedtime = updateCompletedNightBoundary(
      initial,
      'bedtime',
      new Date('2026-08-15T19:50:00.000Z'),
    );
    const edited = updateCompletedNightBoundary(
      bedtime,
      'wakeUp',
      new Date('2026-08-16T06:10:00.000Z'),
    );
    expect(completedNightEditorError(edited, new Date('2026-08-16T07:00:00.000Z'))).toBeNull();
    expect(completedNightBoundariesForSave(edited, new Date('2026-08-16T07:00:00.000Z'))).toEqual([
      {
        id: 'asleep',
        startedAt: new Date('2026-08-15T19:50:00.000Z'),
        endedAt: new Date('2026-08-16T01:00:00.000Z'),
      },
      {
        id: 'awake',
        startedAt: new Date('2026-08-16T01:00:00.000Z'),
        endedAt: new Date('2026-08-16T01:20:00.000Z'),
      },
      {
        id: 'asleep-again',
        startedAt: new Date('2026-08-16T01:20:00.000Z'),
        endedAt: new Date('2026-08-16T06:10:00.000Z'),
      },
    ]);
  });

  it('rejects outer boundaries that cross the retained phase transitions', () => {
    const initial = createCompletedNightEditorState(session);
    expect(
      completedNightEditorError(
        updateCompletedNightBoundary(initial, 'bedtime', new Date('2026-08-16T01:05:00.000Z')),
        new Date('2026-08-16T07:00:00.000Z'),
      ),
    ).toContain('first phase transition');
    expect(
      completedNightEditorError(
        updateCompletedNightBoundary(initial, 'wakeUp', new Date('2026-08-16T01:10:00.000Z')),
        new Date('2026-08-16T07:00:00.000Z'),
      ),
    ).toContain('final phase transition');
  });
});
