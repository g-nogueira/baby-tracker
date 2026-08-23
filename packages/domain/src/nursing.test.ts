import { describe, expect, it } from 'vitest';
import type { NursingSession } from './nursing';
import {
  assertValidNursingSession,
  deleteNursing,
  pauseNursing,
  projectNursingDurations,
  restoreNursing,
  resumeNursing,
  startNursing,
  stopNursing,
  switchNursingSide,
} from './nursing';
import type { MutationContext } from './types';

describe('Nursing lifecycle', () => {
  it.each(['left', 'right'] as const)(
    'starts immediately on %s at a whole-second boundary',
    (side) => {
      const started = startNursing(side, context('2026-08-15T10:00:00.750Z'));

      expect(started.session).toMatchObject({
        id: '2026-08-15T10:00:00.750Z-id-0',
        status: 'active',
        startedAt: '2026-08-15T10:00:00.000Z',
        activeSide: side,
        activeSideStartedAt: '2026-08-15T10:00:00.000Z',
        lastBreastUsed: side,
        leftDurationSeconds: 0,
        rightDurationSeconds: 0,
        totalPauseDurationSeconds: 0,
        version: 1,
      });
      expect(started.operation).toMatchObject({
        entityType: 'nursing_session',
        action: 'start_nursing',
        baseVersion: null,
        clientOccurredAt: '2026-08-15T10:00:00.750Z',
        payload: { startedAt: '2026-08-15T10:00:00.000Z', side },
      });
    },
  );

  it('switches gaplessly and keeps Last explicit even when that side is shorter', () => {
    const started = startNursing('left', context('2026-08-15T10:00:00.000Z')).session;
    const switched = switchNursingSide(started, 'right', context('2026-08-15T10:01:40.900Z'));
    const stopped = stopNursing(switched.session, context('2026-08-15T10:01:50.400Z'));

    expect(switched.session).toMatchObject({
      leftDurationSeconds: 100,
      rightDurationSeconds: 0,
      activeSide: 'right',
      activeSideStartedAt: '2026-08-15T10:01:40.000Z',
      lastBreastUsed: 'right',
      version: 2,
    });
    expect(stopped.session).toMatchObject({
      status: 'completed',
      leftDurationSeconds: 100,
      rightDurationSeconds: 10,
      totalPauseDurationSeconds: 0,
      lastBreastUsed: 'right',
      endedAt: '2026-08-15T10:01:50.000Z',
    });
  });

  it('accrues side and pause totals across pause and selected-side resume', () => {
    const started = startNursing('left', context('2026-08-15T10:00:00.000Z')).session;
    const switched = switchNursingSide(
      started,
      'right',
      context('2026-08-15T10:01:30.000Z'),
    ).session;
    const paused = pauseNursing(switched, context('2026-08-15T10:02:00.000Z')).session;

    expect(projectNursingDurations(paused, new Date('2026-08-15T10:02:15.999Z'))).toEqual({
      leftDurationSeconds: 90,
      rightDurationSeconds: 30,
      pauseDurationSeconds: 15,
      totalDurationSeconds: 120,
    });

    const resumed = resumeNursing(paused, 'left', context('2026-08-15T10:02:20.000Z')).session;
    expect(resumed).toMatchObject({
      status: 'active',
      totalPauseDurationSeconds: 20,
      activeSide: 'left',
      activeSideStartedAt: '2026-08-15T10:02:20.000Z',
      lastBreastUsed: 'left',
    });
    expect(projectNursingDurations(resumed, new Date('2026-08-15T10:02:50.500Z'))).toEqual({
      leftDurationSeconds: 120,
      rightDurationSeconds: 30,
      pauseDurationSeconds: 20,
      totalDurationSeconds: 150,
    });

    const stopped = stopNursing(resumed, context('2026-08-15T10:03:00.000Z'));
    expect(stopped.session).toMatchObject({
      status: 'completed',
      leftDurationSeconds: 130,
      rightDurationSeconds: 30,
      totalPauseDurationSeconds: 20,
      lastBreastUsed: 'left',
      activeSide: null,
      activeSideStartedAt: null,
      pauseStartedAt: null,
    });
    expect(stopped.operation.payload).toMatchObject({
      leftDurationSeconds: 130,
      rightDurationSeconds: 30,
      totalPauseDurationSeconds: 20,
      lastBreastUsed: 'left',
    });
  });

  it('stops from an open pause while preserving the last used side', () => {
    const started = startNursing('right', context('2026-08-15T10:00:00.000Z')).session;
    const paused = pauseNursing(started, context('2026-08-15T10:00:10.000Z')).session;
    const stopped = stopNursing(paused, context('2026-08-15T10:00:30.000Z')).session;

    expect(stopped).toMatchObject({
      rightDurationSeconds: 10,
      totalPauseDurationSeconds: 20,
      lastBreastUsed: 'right',
      endedAt: '2026-08-15T10:00:30.000Z',
    });
  });

  it('rejects invalid state transitions and corrected future or reversed boundaries', () => {
    const active = startNursing('left', context('2026-08-15T10:00:00.000Z')).session;
    expect(() => switchNursingSide(active, 'left', context('2026-08-15T10:00:05.000Z'))).toThrow(
      'Nursing can only switch to the other side.',
    );
    expect(() =>
      pauseNursing(
        active,
        context('2026-08-15T10:00:05.000Z'),
        new Date('2026-08-15T10:00:06.000Z'),
      ),
    ).toThrow('A Nursing boundary cannot be in the future.');
    expect(() => pauseNursing(active, context('2026-08-15T09:59:59.000Z'))).toThrow(
      'A Nursing transition cannot precede its open side or pause.',
    );

    const paused = pauseNursing(active, context('2026-08-15T10:00:05.000Z')).session;
    expect(() => pauseNursing(paused, context('2026-08-15T10:00:06.000Z'))).toThrow(
      'Only active Nursing can change sides or pause.',
    );
    expect(() => switchNursingSide(paused, 'right', context('2026-08-15T10:00:06.000Z'))).toThrow(
      'Only active Nursing can change sides or pause.',
    );
  });

  it('deletes and restores the same versioned identifier', () => {
    const started = startNursing('left', context('2026-08-15T10:00:00.000Z')).session;
    const stopped = stopNursing(started, context('2026-08-15T10:00:30.000Z')).session;
    const deleted = deleteNursing(stopped, context('2026-08-15T10:01:00.900Z'));
    const restored = restoreNursing(deleted.session, context('2026-08-15T10:01:01.000Z'));

    expect(deleted.session).toMatchObject({
      id: started.id,
      version: 3,
      deletedAt: '2026-08-15T10:01:00.000Z',
    });
    expect(restored.session).toMatchObject({ id: started.id, version: 4, deletedAt: null });
    expect(restored.operation).toMatchObject({
      action: 'restore_nursing_session',
      baseVersion: 3,
    });
  });

  it('rejects deleting or restoring an open timer instead of accruing tombstoned time', () => {
    const active = startNursing('left', context('2026-08-15T10:00:00.000Z')).session;
    const paused = pauseNursing(active, context('2026-08-15T10:00:10.000Z')).session;

    expect(() => deleteNursing(active, context('2026-08-15T10:00:20.000Z'))).toThrow(
      'Only completed Nursing sessions can be deleted.',
    );
    expect(() => deleteNursing(paused, context('2026-08-15T10:00:20.000Z'))).toThrow(
      'Only completed Nursing sessions can be deleted.',
    );
    expect(() =>
      restoreNursing(
        { ...active, deletedAt: '2026-08-15T10:00:20.000Z' },
        context('2026-08-15T10:00:21.000Z'),
      ),
    ).toThrow('Only completed Nursing sessions can be restored.');
  });

  it('treats every transition within one effective second as gapless zero-second accrual', () => {
    const started = startNursing('left', context('2026-08-15T10:00:00.100Z')).session;
    const switched = switchNursingSide(
      started,
      'right',
      context('2026-08-15T10:00:00.200Z'),
    ).session;
    const paused = pauseNursing(switched, context('2026-08-15T10:00:00.300Z')).session;
    const resumed = resumeNursing(paused, 'left', context('2026-08-15T10:00:00.400Z')).session;
    const stopped = stopNursing(resumed, context('2026-08-15T10:00:00.500Z')).session;

    expect(stopped).toMatchObject({
      startedAt: '2026-08-15T10:00:00.000Z',
      endedAt: '2026-08-15T10:00:00.000Z',
      leftDurationSeconds: 0,
      rightDurationSeconds: 0,
      totalPauseDurationSeconds: 0,
      lastBreastUsed: 'left',
      status: 'completed',
    });
  });

  it('rejects malformed aggregate state, totals, instants, versions, and timezones', () => {
    const active = startNursing('left', context('2026-08-15T10:00:00.000Z')).session;
    const paused = pauseNursing(active, context('2026-08-15T10:00:10.000Z')).session;
    const completed = stopNursing(paused, context('2026-08-15T10:00:20.000Z')).session;
    const invalidSessions: NursingSession[] = [
      { ...active, version: 1.5 },
      { ...active, activeSide: null },
      { ...paused, activeSide: 'left' },
      { ...completed, leftDurationSeconds: completed.leftDurationSeconds + 1 },
      {
        ...active,
        startedAt: '2026-08-15T10:00:00.500Z',
        activeSideStartedAt: '2026-08-15T10:00:00.500Z',
      },
      {
        ...active,
        startedAt: '2026-02-30T10:00:00.000Z',
        activeSideStartedAt: '2026-02-30T10:00:00.000Z',
      },
      { ...active, timezone: 'Not/A_Timezone' },
    ];

    for (const invalid of invalidSessions) {
      expect(() => assertValidNursingSession(invalid)).toThrow();
    }
  });

  it('accrues real UTC seconds through the Lisbon fall-back transition', () => {
    const started = startNursing('right', context('2026-10-25T00:30:00.000Z')).session;
    const stopped = stopNursing(started, context('2026-10-25T02:30:00.000Z')).session;

    expect(stopped).toMatchObject({
      rightDurationSeconds: 2 * 60 * 60,
      timezone: 'Europe/Lisbon',
    });
  });
});

function context(at: string): MutationContext {
  let sequence = 0;
  return {
    caregiverId: 'caregiver-paloma',
    childId: 'child-arthur',
    now: new Date(at),
    timezone: 'Europe/Lisbon',
    newId: () => `${at}-id-${sequence++}`,
  };
}
