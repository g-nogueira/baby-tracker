import { startNap, stopNap } from './nap';
import {
  correctedNursingLastBreast,
  editCompletedNursing,
  startNursing,
  stopNursing,
  type NursingMutation,
  type NursingSide,
} from './nursing';
import { assertValidSleepSession, endNightSleep, startNightSleep } from './sleep';
import { toUtcInstant } from './time';
import type {
  MutationContext,
  NapMutation,
  NapSession,
  NightSleepMutation,
  NightSleepSession,
  SleepMutation,
  SleepPhase,
} from './types';

/** Records a completed interval atomically, without briefly becoming the active sleep timer. */
export function recordCompletedSleep(
  kind: 'nap' | 'night',
  startedAt: Date,
  endedAt: Date,
  context: MutationContext,
): SleepMutation {
  const completed =
    kind === 'nap'
      ? stopNap(startNap(context, startedAt).session, context, endedAt)
      : endNightSleep(startNightSleep(context, startedAt).session, context, endedAt);
  const phases = completed.session.phases.map((phase) => ({ ...phase, version: 1 }));
  const session = { ...completed.session, version: 1, phases } as NapSession | NightSleepSession;
  assertValidSleepSession(session);
  return {
    session,
    changedPhases: phases,
    operation: {
      ...completed.operation,
      action: 'record_completed_sleep',
      baseVersion: null,
      payload: {
        kind,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        phases: phases.map(({ id, kind, startedAt, endedAt }) => ({
          id,
          kind,
          startedAt,
          endedAt,
        })),
      },
    },
  };
}

/** Reverses an accidental stop on the same Nap; the repository rejects later/active overlaps. */
export function reopenNap(session: NapSession, context: MutationContext): NapMutation {
  assertValidSleepSession(session);
  if (session.deletedAt !== null || session.status !== 'completed')
    throw new Error('Choose a completed Nap to continue.');
  if (session.endedAt === null || session.endedAt > toUtcInstant(context.now))
    throw new Error('The Nap cannot end in the future.');
  const phase = {
    ...session.phases[0],
    endedAt: null,
    version: session.phases[0].version + 1,
    updatedBy: context.caregiverId,
  };
  return {
    session: {
      ...session,
      status: 'active',
      endedAt: null,
      version: session.version + 1,
      updatedBy: context.caregiverId,
      phases: [phase],
    },
    changedPhases: [phase],
    operation: {
      operationId: context.newId(),
      entityId: session.id,
      entityType: 'sleep_session',
      action: 'reopen_nap',
      baseVersion: session.version,
      clientOccurredAt: toUtcInstant(context.now),
      clientTimezone: context.timezone,
      payload: {},
    },
  };
}

/** Inserts a completed waking inside an existing asleep phase without changing the Night's bounds. */
export function recordNightWaking(
  session: NightSleepSession,
  startedAt: Date,
  endedAt: Date,
  context: MutationContext,
): NightSleepMutation {
  assertValidSleepSession(session);
  if (session.deletedAt !== null) throw new Error('This Night sleep was deleted.');
  const start = toUtcInstant(startedAt);
  const end = toUtcInstant(endedAt);
  if (end <= start || end > toUtcInstant(context.now))
    throw new Error('Choose an ordered waking interval in the past.');
  const index = session.phases.findIndex(
    (phase) =>
      phase.kind === 'asleep' &&
      phase.startedAt < start &&
      (phase.endedAt ?? toUtcInstant(context.now)) > end,
  );
  const original = session.phases[index];
  if (original === undefined)
    throw new Error('The waking must fit within one sleeping phase. Adjust its times.');
  const preceding = {
    ...original,
    endedAt: start,
    version: original.version + 1,
    updatedBy: context.caregiverId,
  };
  const make = (kind: 'awake' | 'asleep', at: string, until: string | null): SleepPhase => ({
    ...original,
    id: context.newId(),
    kind,
    startedAt: at,
    endedAt: until,
    version: 1,
    createdBy: context.caregiverId,
    updatedBy: context.caregiverId,
  });
  const waking = make('awake', start, end);
  const following = make('asleep', end, original.endedAt);
  const phases = [
    ...session.phases.slice(0, index),
    preceding,
    waking,
    following,
    ...session.phases.slice(index + 1),
  ];
  const updated = {
    ...session,
    phases,
    version: session.version + 1,
    updatedBy: context.caregiverId,
  };
  assertValidSleepSession(updated);
  return {
    session: updated,
    changedPhases: [preceding, waking, following],
    operation: {
      operationId: context.newId(),
      entityId: session.id,
      entityType: 'sleep_session',
      action: 'record_night_waking',
      baseVersion: session.version,
      clientOccurredAt: toUtcInstant(context.now),
      clientTimezone: context.timezone,
      payload: {
        phases: phases.map(({ id, kind, startedAt, endedAt }) => ({
          id,
          kind,
          startedAt,
          endedAt,
        })),
      },
    },
  };
}

/** Creates completed Nursing with an explicit split/Last and no active timer or artificial pause. */
export function recordCompletedNursing(
  startedAt: Date,
  endedAt: Date,
  leftDurationSeconds: number,
  last: NursingSide,
  context: MutationContext,
): NursingMutation {
  const completed = stopNursing(startNursing(last, context, startedAt).session, context, endedAt);
  if (completed.session.endedAt === null) throw new Error('Completed Nursing needs an end.');
  const corrected = editCompletedNursing(
    completed.session,
    {
      startedAt: new Date(completed.session.startedAt),
      endedAt: new Date(completed.session.endedAt),
      leftDurationSeconds,
    },
    context,
  );
  const session = {
    ...corrected.session,
    version: 1,
    lastBreastUsed: correctedNursingLastBreast(
      last,
      corrected.session.leftDurationSeconds,
      corrected.session.rightDurationSeconds,
    ),
  };
  return {
    session,
    operation: { ...corrected.operation, action: 'record_completed_nursing', baseVersion: null },
  };
}
