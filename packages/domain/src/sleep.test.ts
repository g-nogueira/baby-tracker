import { describe, expect, it } from 'vitest';

import {
  assertValidSleepSession,
  deleteNightSleep,
  editNightSleep,
  endNightSleep,
  restoreNightSleep,
  resumeNightSleep,
  SleepTransitionError,
  startNightSleep,
  startNightWaking,
} from './sleep';
import type { MutationContext } from './types';

describe('Night sleep transitions', () => {
  it('creates Bedtime as one aggregate with its first asleep phase', () => {
    const started = startNightSleep(context('2026-08-12T20:30:00.000Z'));

    expect(started.session).toMatchObject({
      id: '2026-08-12T20:30:00.000Z-id-0',
      kind: 'night',
      status: 'active',
      startedAt: '2026-08-12T20:30:00.000Z',
      endedAt: null,
      timezone: 'Europe/Lisbon',
      version: 1,
      phases: [
        {
          id: '2026-08-12T20:30:00.000Z-id-1',
          kind: 'asleep',
          startedAt: '2026-08-12T20:30:00.000Z',
          endedAt: null,
          version: 1,
        },
      ],
    });
    expect(started.operation).toMatchObject({
      operationId: '2026-08-12T20:30:00.000Z-id-2',
      action: 'start_night_sleep',
      baseVersion: null,
      payload: {
        startedAt: '2026-08-12T20:30:00.000Z',
        phaseId: '2026-08-12T20:30:00.000Z-id-1',
      },
    });
  });

  it('alternates asleep and awake phases in the same stable session', () => {
    const bedtime = startNightSleep(context('2026-08-12T20:30:00.000Z'));
    const waking = startNightWaking(bedtime.session, context('2026-08-13T00:15:00.000Z'));
    const resumed = resumeNightSleep(waking.session, context('2026-08-13T00:35:00.000Z'));

    expect(resumed.session).toMatchObject({
      id: bedtime.session.id,
      status: 'active',
      version: 3,
      phases: [
        {
          id: bedtime.session.phases[0]?.id,
          kind: 'asleep',
          endedAt: '2026-08-13T00:15:00.000Z',
          version: 2,
        },
        {
          kind: 'awake',
          startedAt: '2026-08-13T00:15:00.000Z',
          endedAt: '2026-08-13T00:35:00.000Z',
          version: 2,
        },
        { kind: 'asleep', startedAt: '2026-08-13T00:35:00.000Z', endedAt: null, version: 1 },
      ],
    });
    expect(waking.operation.action).toBe('start_night_waking');
    expect(resumed.operation.action).toBe('resume_night_sleep');
  });

  it('ends directly from an awake phase without creating artificial asleep history', () => {
    const bedtime = startNightSleep(context('2026-08-12T20:30:00.000Z'));
    const waking = startNightWaking(bedtime.session, context('2026-08-13T05:45:00.000Z'));
    const ended = endNightSleep(waking.session, context('2026-08-13T06:10:00.000Z'));

    expect(ended.session).toMatchObject({
      status: 'completed',
      endedAt: '2026-08-13T06:10:00.000Z',
      phases: [
        { kind: 'asleep', endedAt: '2026-08-13T05:45:00.000Z' },
        { kind: 'awake', endedAt: '2026-08-13T06:10:00.000Z' },
      ],
    });
    expect(ended.session.phases).toHaveLength(2);
    expect(ended.operation.action).toBe('end_night_sleep');
  });

  it('ends directly from the initial asleep phase', () => {
    const bedtime = startNightSleep(context('2026-08-12T20:30:00.000Z'));
    const ended = endNightSleep(bedtime.session, context('2026-08-13T06:10:00.000Z'));

    expect(ended.session).toMatchObject({
      id: bedtime.session.id,
      status: 'completed',
      endedAt: '2026-08-13T06:10:00.000Z',
      phases: [{ kind: 'asleep', endedAt: '2026-08-13T06:10:00.000Z' }],
    });
    expect(ended.operation.action).toBe('end_night_sleep');
  });

  it('rejects duplicate, reversed, future, completed, and deleted transitions', () => {
    const bedtime = startNightSleep(context('2026-08-12T20:30:00.000Z')).session;

    expect(() => resumeNightSleep(bedtime, context('2026-08-12T20:45:00.000Z'))).toThrow(
      'Night sleep can only resume while the child is awake.',
    );
    expect(() => startNightWaking(bedtime, context('2026-08-12T20:30:00.000Z'))).toThrow(
      'A sleep transition must occur after the open phase starts.',
    );
    expect(() =>
      startNightWaking(
        bedtime,
        context('2026-08-12T20:45:00.000Z'),
        new Date('2026-08-12T20:46:00.000Z'),
      ),
    ).toThrow('A sleep transition cannot be in the future.');

    const ended = endNightSleep(bedtime, context('2026-08-12T21:00:00.000Z')).session;
    expect(() => endNightSleep(ended, context('2026-08-12T21:01:00.000Z'))).toThrow(
      'Only an active Night session can transition.',
    );
    expect(() =>
      startNightWaking(
        { ...bedtime, deletedAt: '2026-08-12T20:40:00.000Z' },
        context('2026-08-12T20:45:00.000Z'),
      ),
    ).toThrowError(SleepTransitionError);
  });

  it('preserves UTC ordering through Europe/Lisbon spring-forward and fall-back', () => {
    const spring = startNightSleep(context('2026-03-29T00:30:00.000Z')).session;
    const springWaking = startNightWaking(spring, context('2026-03-29T01:30:00.000Z')).session;
    expect(springWaking.timezone).toBe('Europe/Lisbon');
    expect(springWaking.phases.map(({ startedAt }) => startedAt)).toEqual([
      '2026-03-29T00:30:00.000Z',
      '2026-03-29T01:30:00.000Z',
    ]);

    const fall = startNightSleep(context('2026-10-25T00:30:00.000Z')).session;
    const fallWaking = startNightWaking(fall, context('2026-10-25T01:30:00.000Z')).session;
    expect(fallWaking.phases[0]?.endedAt).toBe('2026-10-25T01:30:00.000Z');
    expect(fallWaking.phases[1]?.startedAt).toBe('2026-10-25T01:30:00.000Z');
  });

  it('rejects phase-boundary edits that break alternation or session ordering', () => {
    const bedtime = startNightSleep(context('2026-08-12T20:30:00.000Z')).session;
    const waking = startNightWaking(bedtime, context('2026-08-13T00:15:00.000Z')).session;

    expect(() =>
      editNightSleep(
        waking,
        [
          {
            id: waking.phases[0]?.id ?? '',
            startedAt: new Date('2026-08-12T20:30:00.000Z'),
            endedAt: new Date('2026-08-13T00:10:00.000Z'),
          },
          {
            id: waking.phases[1]?.id ?? '',
            startedAt: new Date('2026-08-13T00:15:00.000Z'),
            endedAt: null,
          },
        ],
        context('2026-08-13T00:20:00.000Z'),
      ),
    ).toThrow('Night phases must be contiguous and ordered.');
  });

  it('edits Night boundaries without changing phase identity or alternation', () => {
    const bedtime = startNightSleep(context('2026-08-12T20:30:00.000Z')).session;
    const waking = startNightWaking(bedtime, context('2026-08-13T00:15:00.000Z')).session;
    const ended = endNightSleep(waking, context('2026-08-13T00:35:00.000Z')).session;
    const edited = editNightSleep(
      ended,
      [
        {
          id: ended.phases[0]?.id ?? '',
          startedAt: new Date('2026-08-12T20:20:00.000Z'),
          endedAt: new Date('2026-08-13T00:10:00.000Z'),
        },
        {
          id: ended.phases[1]?.id ?? '',
          startedAt: new Date('2026-08-13T00:10:00.000Z'),
          endedAt: new Date('2026-08-13T00:40:00.000Z'),
        },
      ],
      context('2026-08-13T01:00:00.000Z'),
    );

    expect(edited.session).toMatchObject({
      id: ended.id,
      startedAt: '2026-08-12T20:20:00.000Z',
      endedAt: '2026-08-13T00:40:00.000Z',
      version: 4,
      phases: [
        { id: ended.phases[0]?.id, kind: 'asleep', version: 3 },
        { id: ended.phases[1]?.id, kind: 'awake', version: 3 },
      ],
    });
    expect(edited.operation).toMatchObject({ action: 'edit_sleep_session', baseVersion: 3 });
    expect(edited.operation.payload.phases).toEqual([
      {
        id: ended.phases[0]?.id,
        startedAt: '2026-08-12T20:20:00.000Z',
        endedAt: '2026-08-13T00:10:00.000Z',
      },
      {
        id: ended.phases[1]?.id,
        startedAt: '2026-08-13T00:10:00.000Z',
        endedAt: '2026-08-13T00:40:00.000Z',
      },
    ]);
  });

  it('rejects duplicate phase identifiers before another transition can replace both', () => {
    const bedtime = startNightSleep(context('2026-08-12T20:30:00.000Z')).session;
    const waking = startNightWaking(bedtime, context('2026-08-13T00:15:00.000Z')).session;
    const firstPhase = waking.phases[0];
    const secondPhase = waking.phases[1];
    if (firstPhase === undefined || secondPhase === undefined) {
      throw new Error('Expected two Night phases.');
    }
    const duplicate = {
      ...waking,
      phases: [firstPhase, { ...secondPhase, id: firstPhase.id }],
    };

    expect(() => resumeNightSleep(duplicate, context('2026-08-13T00:35:00.000Z'))).toThrow(
      'Sleep phase identifiers must be unique within their session.',
    );
  });

  it('requires session and phase tombstones to remain consistent', () => {
    const bedtime = startNightSleep(context('2026-08-12T20:30:00.000Z')).session;

    expect(() =>
      assertValidSleepSession({ ...bedtime, deletedAt: '2026-08-12T21:00:00.000Z' }),
    ).toThrow('Session and phase tombstones must be consistent.');
  });

  it('deletes and restores a completed Night with every phase in one versioned mutation', () => {
    const bedtime = startNightSleep(context('2026-08-12T20:30:00.000Z')).session;
    const waking = startNightWaking(bedtime, context('2026-08-13T00:15:00.000Z')).session;
    const completed = endNightSleep(waking, context('2026-08-13T00:35:00.000Z')).session;
    const deleted = deleteNightSleep(completed, context('2026-08-13T01:00:00.000Z'));

    expect(deleted.session.deletedAt).toBe('2026-08-13T01:00:00.000Z');
    expect(
      deleted.session.phases.every((phase) => phase.deletedAt === deleted.session.deletedAt),
    ).toBe(true);
    expect(deleted.changedPhases).toHaveLength(2);
    expect(deleted.operation).toMatchObject({ action: 'delete_sleep_session', baseVersion: 3 });

    const restored = restoreNightSleep(deleted.session, context('2026-08-13T01:05:00.000Z'));
    expect(restored.session.deletedAt).toBeNull();
    expect(restored.session.phases.every((phase) => phase.deletedAt === null)).toBe(true);
    expect(restored.operation).toMatchObject({ action: 'restore_sleep_session', baseVersion: 4 });
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
