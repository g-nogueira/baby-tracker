import { toUtcInstant } from './time';
import type { MutationContext, NapMutation, NapSession } from './types';

/**
 * Starts an active nap session at the specified time.
 *
 * @param startedAt - The nap start time, defaulting to the operation time
 * @returns The newly created nap session and its start operation
 */
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

/**
 * Completes an active nap at the specified time.
 *
 * @param endedAt - The time the nap ended; defaults to the operation time.
 * @returns The updated nap session and stop operation.
 */
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

/**
 * Corrects the timestamps of an existing nap session.
 *
 * @param session - The nap session to update
 * @param startedAt - The corrected start timestamp
 * @param endedAt - The corrected end timestamp, or `null` for an active nap
 * @param context - The mutation context used to record the update
 * @returns The updated nap session and corresponding edit operation
 * @throws Error If the session is deleted, timestamps are inconsistent with the session status, the interval is invalid, or a timestamp is in the future
 */
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

/**
 * Marks a nap session and its current phase as deleted.
 *
 * @param session - The nap session to delete
 * @returns The updated session and delete operation
 * @throws Error if the nap session has already been deleted
 */
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

/**
 * Restores a deleted nap session and its phase.
 *
 * @param session - The deleted nap session to restore
 * @returns The restored session and corresponding restore operation
 */
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

/**
 * Ensures that a nap is active, undeleted, and has no recorded end time.
 *
 * @throws If the nap is deleted, completed, or has an end time.
 */
function assertEditableActiveNap(session: NapSession): void {
  assertNotDeleted(session);

  if (session.status !== 'active' || session.endedAt !== null || session.phase.endedAt !== null) {
    throw new Error('Only an active nap can be stopped.');
  }
}

/**
 * Ensures that a nap session can still be changed.
 *
 * @param session - The nap session to check
 * @throws If the nap session has been deleted
 */
function assertNotDeleted(session: NapSession): void {
  if (session.deletedAt !== null) {
    throw new Error('A deleted nap cannot be changed.');
  }
}

/**
 * Validates that a nap ends after it starts.
 *
 * @param startedAt - The nap start timestamp
 * @param endedAt - The nap end timestamp
 */
function assertValidInterval(startedAt: string, endedAt: string): void {
  if (endedAt <= startedAt) {
    throw new Error('A nap must end after it starts.');
  }
}

/**
 * Ensures a nap timestamp does not occur after the operation timestamp.
 *
 * @param instant - The nap timestamp to validate
 * @param occurredAt - The timestamp when the operation occurred
 * @throws If `instant` is later than `occurredAt`
 */
function assertNotFuture(instant: string, occurredAt: string): void {
  if (instant > occurredAt) {
    throw new Error('A nap time cannot be in the future.');
  }
}
