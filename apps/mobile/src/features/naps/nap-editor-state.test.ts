import { describe, expect, it } from 'vitest';

import { editorIntervalError, mergeDatePart, mergeTimePart } from './nap-editor-state';

describe('nap editor state', () => {
  it('rejects equal and reversed intervals with an inline message', () => {
    const nap = completedNap();

    expect(
      editorIntervalError(
        {
          mode: 'edit',
          nap,
          startedAt: new Date('2026-08-12T10:00:00.000Z'),
          endedAt: new Date('2026-08-12T10:00:00.000Z'),
        },
        new Date('2026-08-12T12:00:00.000Z'),
      ),
    ).toBe('End time must be after start time.');
    expect(
      editorIntervalError(
        {
          mode: 'edit',
          nap,
          startedAt: new Date('2026-08-12T10:01:00.000Z'),
          endedAt: new Date('2026-08-12T10:00:00.000Z'),
        },
        new Date('2026-08-12T12:00:00.000Z'),
      ),
    ).toBe('End time must be after start time.');
    expect(
      editorIntervalError(
        {
          mode: 'edit',
          nap,
          startedAt: new Date('2026-08-12T10:31:00.000Z'),
          endedAt: new Date('2026-08-12T10:30:00.000Z'),
        },
        new Date('2026-08-12T12:00:00.000Z'),
      ),
    ).toBe('End time must be after start time.');
  });

  it('accepts a cross-midnight interval', () => {
    expect(
      editorIntervalError(
        {
          mode: 'edit',
          nap: completedNap(),
          startedAt: new Date('2026-08-12T23:50:00.000Z'),
          endedAt: new Date('2026-08-13T00:20:00.000Z'),
        },
        new Date('2026-08-13T01:00:00.000Z'),
      ),
    ).toBeNull();
  });

  it('rejects future nap boundaries', () => {
    expect(
      editorIntervalError(
        { mode: 'start', startedAt: new Date('2026-08-12T12:01:00.000Z') },
        new Date('2026-08-12T12:00:00.000Z'),
      ),
    ).toBe('Nap times cannot be in the future.');
  });

  it('merges native date and time picker values without losing the other part', () => {
    const current = new Date('2026-08-12T13:35:20.500Z');
    const selectedDate = new Date('2026-08-15T07:00:00.000Z');
    const selectedTime = new Date('2026-08-01T08:42:00.000Z');

    expect(mergeDatePart(current, selectedDate, 'Europe/Lisbon')).toEqual(
      new Date('2026-08-15T13:35:20.000Z'),
    );
    expect(mergeTimePart(current, selectedTime, 'Europe/Lisbon')).toEqual(
      new Date('2026-08-12T08:42:00.000Z'),
    );
  });
});

function completedNap() {
  return {
    id: 'session-id',
    childId: 'child-id',
    kind: 'nap' as const,
    startedAt: '2026-08-12T10:00:00.000Z',
    endedAt: '2026-08-12T10:30:00.000Z',
    status: 'completed' as const,
    timezone: 'Europe/Lisbon',
    createdBy: 'caregiver-id',
    updatedBy: 'caregiver-id',
    version: 2,
    deletedAt: null,
    phase: {
      id: 'phase-id',
      sleepSessionId: 'session-id',
      kind: 'asleep' as const,
      startedAt: '2026-08-12T10:00:00.000Z',
      endedAt: '2026-08-12T10:30:00.000Z',
      createdBy: 'caregiver-id',
      updatedBy: 'caregiver-id',
      version: 2,
      deletedAt: null,
    },
  };
}
