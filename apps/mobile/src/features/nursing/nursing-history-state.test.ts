import type { NursingSession } from '@baby-tracker/domain';
import { describe, expect, it } from 'vitest';

import { completedNursingHistory, completedNursingRecordById } from './nursing-history-state';

describe('Nursing history state', () => {
  it('preserves repository chronology while excluding live and deleted sessions', () => {
    const newest = session({ id: 'newest', startedAt: '2026-08-15T12:00:00.000Z' });
    const oldest = session({ id: 'oldest', startedAt: '2026-08-15T09:00:00.000Z' });
    const active = session({
      id: 'active',
      status: 'active',
      endedAt: null,
      activeSide: 'left',
      activeSideStartedAt: '2026-08-15T13:00:00.000Z',
      lastBreastUsed: 'left',
      startedAt: '2026-08-15T13:00:00.000Z',
      leftDurationSeconds: 0,
      rightDurationSeconds: 0,
    });
    const deleted = session({ id: 'deleted', deletedAt: '2026-08-15T14:00:00.000Z' });

    expect(completedNursingHistory([newest, active, oldest, deleted]).map(({ id }) => id)).toEqual([
      'newest',
      'oldest',
    ]);
  });

  it('opens only the exact visible completed identifier', () => {
    const first = session({ id: 'first' });
    const second = session({ id: 'second' });
    const deleted = session({ id: 'deleted', deletedAt: '2026-08-15T14:00:00.000Z' });

    expect(completedNursingRecordById([first, second, deleted], 'second')).toBe(second);
    expect(completedNursingRecordById([first, second, deleted], 'missing')).toBeNull();
    expect(completedNursingRecordById([first, second, deleted], 'deleted')).toBeNull();
  });
});

function session(overrides: Partial<NursingSession> = {}): NursingSession {
  return {
    id: 'nursing-session',
    childId: 'child-arthur',
    startedAt: '2026-08-15T10:00:00.000Z',
    endedAt: '2026-08-15T10:01:00.000Z',
    status: 'completed',
    leftDurationSeconds: 20,
    rightDurationSeconds: 30,
    totalPauseDurationSeconds: 10,
    activeSide: null,
    activeSideStartedAt: null,
    pauseStartedAt: null,
    lastBreastUsed: 'right',
    timezone: 'Europe/Lisbon',
    createdBy: 'caregiver-paloma',
    updatedBy: 'caregiver-paloma',
    version: 3,
    deletedAt: null,
    ...overrides,
  };
}
