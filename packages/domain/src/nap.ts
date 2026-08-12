import { toUtcInstant } from './time';
import type { MutationContext, NapMutation, NapSession } from './types';

export function startNap(context: MutationContext, startedAt: Date = context.now): NapMutation {
  const occurredAt = toUtcInstant(context.now);
  const selectedStartedAt = toUtcInstant(startedAt);
  assertNotFuture(selectedStartedAt, occurredAt);
  const sessionId = context.newId();

  return {
    session: {
      id: sessionId,
      childId: context.childId,
      kind: 'nap',
      startedAt: selectedStartedAt,
      endedAt: null,
      status: 'active',
      timezone: context.timezone,
      createdBy: context.caregiverId,
      updatedBy: context.caregiverId,
      version: 1,
      deletedAt: null,
      phase: {
        id: context.newId(),
        sleepSessionId: sessionId,
        kind: 'asleep',
        startedAt: selectedStartedAt,
        endedAt: null,
        createdBy: context.caregiverId,
        updatedBy: context.caregiverId,
        version: 1,
        deletedAt: null,
      },
    },
    operation: {
      operationId: context.newId(),
      entityId: sessionId,
      entityType: 'sleep_session',
      action: 'start_nap',
      baseVersion: null,
      clientOccurredAt: occurredAt,
      clientTimezone: context.timezone,
      payload: { startedAt: selectedStartedAt },
    },
  };
}

export function stopNap(
  session: NapSession,
  context: MutationContext,
  endedAt: Date = context.now,
): NapMutation {
  assertEditableActiveNap(session);
  const occurredAt = toUtcInstant(context.now);
  const selectedEndedAt = toUtcInstant(endedAt);

  assertNotFuture(selectedEndedAt, occurredAt);
  assertValidInterval(session.startedAt, selectedEndedAt);

  return {
    session: {
      ...session,
      endedAt: selectedEndedAt,
      status: 'completed',
      updatedBy: context.caregiverId,
      version: session.version + 1,
      phase: {
        ...session.phase,
        endedAt: selectedEndedAt,
        updatedBy: context.caregiverId,
        version: session.phase.version + 1,
      },
    },
    operation: {
      operationId: context.newId(),
      entityId: session.id,
      entityType: 'sleep_session',
      action: 'stop_nap',
      baseVersion: session.version,
      clientOccurredAt: occurredAt,
      clientTimezone: context.timezone,
      payload: { endedAt: selectedEndedAt },
    },
  };
}

export function editNap(
  session: NapSession,
  startedAt: Date,
  endedAt: Date | null,
  context: MutationContext,
): NapMutation {
  assertNotDeleted(session);

  const correctedStartedAt = toUtcInstant(startedAt);
  const correctedEndedAt = endedAt === null ? null : toUtcInstant(endedAt);

  if (session.status === 'active' && correctedEndedAt !== null) {
    throw new Error('An active nap cannot have an end time.');
  }

  if (session.status === 'completed' && correctedEndedAt === null) {
    throw new Error('A completed nap requires an end time.');
  }

  if (correctedEndedAt !== null) {
    assertValidInterval(correctedStartedAt, correctedEndedAt);
  }

  const occurredAt = toUtcInstant(context.now);
  assertNotFuture(correctedStartedAt, occurredAt);
  if (correctedEndedAt !== null) assertNotFuture(correctedEndedAt, occurredAt);
  const payload: Record<string, string> = { startedAt: correctedStartedAt };
  if (correctedEndedAt !== null) {
    payload.endedAt = correctedEndedAt;
  }

  return {
    session: {
      ...session,
      startedAt: correctedStartedAt,
      endedAt: correctedEndedAt,
      updatedBy: context.caregiverId,
      version: session.version + 1,
      phase: {
        ...session.phase,
        startedAt: correctedStartedAt,
        endedAt: correctedEndedAt,
        updatedBy: context.caregiverId,
        version: session.phase.version + 1,
      },
    },
    operation: {
      operationId: context.newId(),
      entityId: session.id,
      entityType: 'sleep_session',
      action: 'edit_sleep_session',
      baseVersion: session.version,
      clientOccurredAt: occurredAt,
      clientTimezone: context.timezone,
      payload,
    },
  };
}

export function deleteNap(session: NapSession, context: MutationContext): NapMutation {
  if (session.deletedAt !== null) {
    throw new Error('This nap is already deleted.');
  }

  const occurredAt = toUtcInstant(context.now);

  return {
    session: {
      ...session,
      updatedBy: context.caregiverId,
      version: session.version + 1,
      deletedAt: occurredAt,
      phase: {
        ...session.phase,
        updatedBy: context.caregiverId,
        version: session.phase.version + 1,
        deletedAt: occurredAt,
      },
    },
    operation: {
      operationId: context.newId(),
      entityId: session.id,
      entityType: 'sleep_session',
      action: 'delete_sleep_session',
      baseVersion: session.version,
      clientOccurredAt: occurredAt,
      clientTimezone: context.timezone,
      payload: {},
    },
  };
}

export function restoreNap(session: NapSession, context: MutationContext): NapMutation {
  if (session.deletedAt === null) {
    throw new Error('Only a deleted nap can be restored.');
  }

  const occurredAt = toUtcInstant(context.now);

  return {
    session: {
      ...session,
      updatedBy: context.caregiverId,
      version: session.version + 1,
      deletedAt: null,
      phase: {
        ...session.phase,
        updatedBy: context.caregiverId,
        version: session.phase.version + 1,
        deletedAt: null,
      },
    },
    operation: {
      operationId: context.newId(),
      entityId: session.id,
      entityType: 'sleep_session',
      action: 'restore_sleep_session',
      baseVersion: session.version,
      clientOccurredAt: occurredAt,
      clientTimezone: context.timezone,
      payload: {},
    },
  };
}

function assertEditableActiveNap(session: NapSession): void {
  assertNotDeleted(session);

  if (session.status !== 'active' || session.endedAt !== null || session.phase.endedAt !== null) {
    throw new Error('Only an active nap can be stopped.');
  }
}

function assertNotDeleted(session: NapSession): void {
  if (session.deletedAt !== null) {
    throw new Error('A deleted nap cannot be changed.');
  }
}

function assertValidInterval(startedAt: string, endedAt: string): void {
  if (endedAt <= startedAt) {
    throw new Error('A nap must end after it starts.');
  }
}

function assertNotFuture(instant: string, occurredAt: string): void {
  if (instant > occurredAt) {
    throw new Error('A nap time cannot be in the future.');
  }
}
