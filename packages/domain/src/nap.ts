import { toUtcInstant } from './time';
import type { MutationContext, NapMutation, NapSession } from './types';

export function startNap(context: MutationContext): NapMutation {
  const occurredAt = toUtcInstant(context.now);
  const sessionId = context.newId();

  return {
    session: {
      id: sessionId,
      childId: context.childId,
      kind: 'nap',
      startedAt: occurredAt,
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
        startedAt: occurredAt,
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
      payload: {},
    },
  };
}

export function stopNap(session: NapSession, context: MutationContext): NapMutation {
  assertEditableActiveNap(session);
  const occurredAt = toUtcInstant(context.now);

  if (occurredAt < session.startedAt) {
    throw new Error('A nap cannot end before it starts.');
  }

  return {
    session: {
      ...session,
      endedAt: occurredAt,
      status: 'completed',
      updatedBy: context.caregiverId,
      version: session.version + 1,
      phase: {
        ...session.phase,
        endedAt: occurredAt,
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
      payload: { endedAt: occurredAt },
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

function assertEditableActiveNap(session: NapSession): void {
  if (session.deletedAt !== null) {
    throw new Error('A deleted nap cannot be changed.');
  }

  if (session.status !== 'active' || session.endedAt !== null || session.phase.endedAt !== null) {
    throw new Error('Only an active nap can be stopped.');
  }
}
