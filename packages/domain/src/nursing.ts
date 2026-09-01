import { toUtcInstant } from './time';
import type { JsonValue, MutationContext, UtcInstant } from './types';

export type NursingSide = 'left' | 'right';
export type NursingStatus = 'active' | 'paused' | 'completed';

export interface NursingSession {
  id: string;
  childId: string;
  startedAt: UtcInstant;
  endedAt: UtcInstant | null;
  status: NursingStatus;
  leftDurationSeconds: number;
  rightDurationSeconds: number;
  totalPauseDurationSeconds: number;
  activeSide: NursingSide | null;
  activeSideStartedAt: UtcInstant | null;
  pauseStartedAt: UtcInstant | null;
  lastBreastUsed: NursingSide;
  timezone: string;
  createdBy: string;
  updatedBy: string;
  version: number;
  deletedAt: UtcInstant | null;
}

export type NursingAction =
  | 'start_nursing'
  | 'switch_nursing_side'
  | 'pause_nursing'
  | 'resume_nursing'
  | 'stop_nursing'
  | 'edit_nursing_session'
  | 'delete_nursing_session'
  | 'restore_nursing_session';

export interface NursingOperation {
  operationId: string;
  entityId: string;
  entityType: 'nursing_session';
  action: NursingAction;
  baseVersion: number | null;
  clientOccurredAt: UtcInstant;
  clientTimezone: string;
  payload: Readonly<Record<string, JsonValue>>;
}

export interface NursingMutation {
  session: NursingSession;
  operation: NursingOperation;
}

export interface NursingDurationProjection {
  leftDurationSeconds: number;
  rightDurationSeconds: number;
  pauseDurationSeconds: number;
  totalDurationSeconds: number;
}

export interface CompletedNursingCorrection {
  startedAt: Date;
  endedAt: Date;
  leftDurationSeconds: number;
}

export type NursingErrorCode =
  | 'deleted_session'
  | 'future_boundary'
  | 'invalid_aggregate'
  | 'invalid_correction'
  | 'invalid_transition'
  | 'transition_before_open_interval';

export class NursingError extends Error {
  public constructor(
    public readonly code: NursingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'NursingError';
  }
}

/** Starts Nursing immediately on the explicitly selected side. */
export function startNursing(
  side: NursingSide,
  context: MutationContext,
  startedAt: Date = context.now,
): NursingMutation {
  const occurredAt = toUtcInstant(context.now);
  const selectedStartedAt = effectiveBoundary(startedAt, occurredAt);
  const session: NursingSession = {
    id: context.newId(),
    childId: context.childId,
    startedAt: selectedStartedAt,
    endedAt: null,
    status: 'active',
    leftDurationSeconds: 0,
    rightDurationSeconds: 0,
    totalPauseDurationSeconds: 0,
    activeSide: side,
    activeSideStartedAt: selectedStartedAt,
    pauseStartedAt: null,
    lastBreastUsed: side,
    timezone: context.timezone,
    createdBy: context.caregiverId,
    updatedBy: context.caregiverId,
    version: 1,
    deletedAt: null,
  };
  assertValidNursingSession(session);
  return mutation(session, context, occurredAt, 'start_nursing', null, {
    startedAt: selectedStartedAt,
    side,
  });
}

/** Atomically accrues the running side and begins the opposite selected side. */
export function switchNursingSide(
  session: NursingSession,
  nextSide: NursingSide,
  context: MutationContext,
  switchedAt: Date = context.now,
): NursingMutation {
  assertActive(session);
  if (nextSide === session.activeSide) {
    throw new NursingError('invalid_transition', 'Nursing can only switch to the other side.');
  }
  const occurredAt = toUtcInstant(context.now);
  const transitionAt = effectiveBoundary(switchedAt, occurredAt, session.activeSideStartedAt);
  const accrued = accrueActiveSide(session, transitionAt);
  const updated: NursingSession = {
    ...accrued,
    activeSide: nextSide,
    activeSideStartedAt: transitionAt,
    lastBreastUsed: nextSide,
    updatedBy: context.caregiverId,
    version: session.version + 1,
  };
  assertValidNursingSession(updated);
  return mutation(updated, context, occurredAt, 'switch_nursing_side', session.version, {
    transitionAt,
    side: nextSide,
  });
}

/** Accrues the active side and opens a pause at the same effective instant. */
export function pauseNursing(
  session: NursingSession,
  context: MutationContext,
  pausedAt: Date = context.now,
): NursingMutation {
  assertActive(session);
  const occurredAt = toUtcInstant(context.now);
  const transitionAt = effectiveBoundary(pausedAt, occurredAt, session.activeSideStartedAt);
  const accrued = accrueActiveSide(session, transitionAt);
  const updated: NursingSession = {
    ...accrued,
    status: 'paused',
    activeSide: null,
    activeSideStartedAt: null,
    pauseStartedAt: transitionAt,
    updatedBy: context.caregiverId,
    version: session.version + 1,
  };
  assertValidNursingSession(updated);
  return mutation(updated, context, occurredAt, 'pause_nursing', session.version, {
    pausedAt: transitionAt,
  });
}

/** Accrues the open pause and resumes on either explicitly selected side. */
export function resumeNursing(
  session: NursingSession,
  side: NursingSide,
  context: MutationContext,
  resumedAt: Date = context.now,
): NursingMutation {
  assertPaused(session);
  const occurredAt = toUtcInstant(context.now);
  const transitionAt = effectiveBoundary(resumedAt, occurredAt, session.pauseStartedAt);
  const updated: NursingSession = {
    ...session,
    status: 'active',
    totalPauseDurationSeconds:
      session.totalPauseDurationSeconds + elapsedSeconds(session.pauseStartedAt, transitionAt),
    activeSide: side,
    activeSideStartedAt: transitionAt,
    pauseStartedAt: null,
    lastBreastUsed: side,
    updatedBy: context.caregiverId,
    version: session.version + 1,
  };
  assertValidNursingSession(updated);
  return mutation(updated, context, occurredAt, 'resume_nursing', session.version, {
    resumedAt: transitionAt,
    side,
  });
}

/** Completes Nursing from either an active side or an open pause. */
export function stopNursing(
  session: NursingSession,
  context: MutationContext,
  endedAt: Date = context.now,
): NursingMutation {
  assertMutable(session);
  if (session.status === 'completed') {
    throw new NursingError('invalid_transition', 'Only active or paused Nursing can stop.');
  }
  const occurredAt = toUtcInstant(context.now);
  const openStartedAt =
    session.status === 'active' ? session.activeSideStartedAt : session.pauseStartedAt;
  const selectedEndedAt = effectiveBoundary(endedAt, occurredAt, openStartedAt);
  let accrued: NursingSession;
  if (session.status === 'active') {
    if (session.activeSide === null || session.activeSideStartedAt === null) {
      throw invalidAggregate('Active Nursing requires exactly one open side.');
    }
    accrued = accrueActiveSide(
      {
        ...session,
        activeSide: session.activeSide,
        activeSideStartedAt: session.activeSideStartedAt,
      },
      selectedEndedAt,
    );
  } else {
    accrued = {
      ...session,
      totalPauseDurationSeconds:
        session.totalPauseDurationSeconds + elapsedSeconds(session.pauseStartedAt, selectedEndedAt),
    };
  }
  const completed: NursingSession = {
    ...accrued,
    endedAt: selectedEndedAt,
    status: 'completed',
    activeSide: null,
    activeSideStartedAt: null,
    pauseStartedAt: null,
    updatedBy: context.caregiverId,
    version: session.version + 1,
  };
  assertValidNursingSession(completed);
  return mutation(completed, context, occurredAt, 'stop_nursing', session.version, {
    endedAt: selectedEndedAt,
    leftDurationSeconds: completed.leftDurationSeconds,
    rightDurationSeconds: completed.rightDurationSeconds,
    totalPauseDurationSeconds: completed.totalPauseDurationSeconds,
    lastBreastUsed: completed.lastBreastUsed,
  });
}

/** Corrects one completed Nursing aggregate while preserving its pause duration and identity. */
export function editCompletedNursing(
  session: NursingSession,
  correction: CompletedNursingCorrection,
  context: MutationContext,
): NursingMutation {
  assertMutable(session);
  if (session.status !== 'completed') {
    throw new NursingError(
      'invalid_transition',
      'Only completed Nursing sessions can be corrected.',
    );
  }

  const occurredAt = toUtcInstant(context.now);
  const startedAt = correctedBoundary(correction.startedAt, occurredAt);
  const endedAt = correctedBoundary(correction.endedAt, occurredAt);
  if (endedAt < startedAt) {
    throw invalidCorrection('Nursing end time must not precede its start time.');
  }
  const elapsedDurationSeconds = elapsedSeconds(startedAt, endedAt);
  const activeDurationSeconds = elapsedDurationSeconds - session.totalPauseDurationSeconds;
  if (activeDurationSeconds < 0) {
    throw invalidCorrection('Nursing boundaries cannot be shorter than the preserved pause time.');
  }
  if (
    !Number.isSafeInteger(correction.leftDurationSeconds) ||
    correction.leftDurationSeconds < 0 ||
    correction.leftDurationSeconds > activeDurationSeconds
  ) {
    throw invalidCorrection('Left Nursing time must be a whole second within active duration.');
  }

  const rightDurationSeconds = activeDurationSeconds - correction.leftDurationSeconds;
  const lastBreastUsed = correctedNursingLastBreast(
    session.lastBreastUsed,
    correction.leftDurationSeconds,
    rightDurationSeconds,
  );
  const corrected: NursingSession = {
    ...session,
    startedAt,
    endedAt,
    leftDurationSeconds: correction.leftDurationSeconds,
    rightDurationSeconds,
    lastBreastUsed,
    updatedBy: context.caregiverId,
    version: session.version + 1,
  };
  assertValidNursingSession(corrected);
  return mutation(corrected, context, occurredAt, 'edit_nursing_session', session.version, {
    startedAt: corrected.startedAt,
    endedAt: corrected.endedAt,
    status: corrected.status,
    leftDurationSeconds: corrected.leftDurationSeconds,
    rightDurationSeconds: corrected.rightDurationSeconds,
    totalPauseDurationSeconds: corrected.totalPauseDurationSeconds,
    activeSide: corrected.activeSide,
    activeSideStartedAt: corrected.activeSideStartedAt,
    pauseStartedAt: corrected.pauseStartedAt,
    lastBreastUsed: corrected.lastBreastUsed,
    deletedAt: corrected.deletedAt,
  });
}

/** Resolves Last from the final split without ever inferring it from the longer side. */
export function correctedNursingLastBreast(
  originalLastBreastUsed: NursingSide,
  leftDurationSeconds: number,
  rightDurationSeconds: number,
): NursingSide {
  if (leftDurationSeconds === 0 && rightDurationSeconds > 0) return 'right';
  if (rightDurationSeconds === 0 && leftDurationSeconds > 0) return 'left';
  return originalLastBreastUsed;
}

/** Creates a versioned tombstone without changing live timing fields. */
export function deleteNursing(session: NursingSession, context: MutationContext): NursingMutation {
  if (session.deletedAt !== null) {
    throw new NursingError('deleted_session', 'This Nursing session is already deleted.');
  }
  assertValidNursingSession(session);
  if (session.status !== 'completed') {
    throw new NursingError('invalid_transition', 'Only completed Nursing sessions can be deleted.');
  }
  const occurredAt = toUtcInstant(context.now);
  const deleted: NursingSession = {
    ...session,
    updatedBy: context.caregiverId,
    version: session.version + 1,
    deletedAt: toWholeSecond(context.now),
  };
  return mutation(deleted, context, occurredAt, 'delete_nursing_session', session.version, {});
}

/** Restores a Nursing tombstone with the same aggregate identifier. */
export function restoreNursing(session: NursingSession, context: MutationContext): NursingMutation {
  if (session.deletedAt === null) {
    throw new NursingError('invalid_transition', 'Only deleted Nursing can be restored.');
  }
  assertValidNursingSession(session);
  if (session.status !== 'completed') {
    throw new NursingError(
      'invalid_transition',
      'Only completed Nursing sessions can be restored.',
    );
  }
  const occurredAt = toUtcInstant(context.now);
  const restored: NursingSession = {
    ...session,
    updatedBy: context.caregiverId,
    version: session.version + 1,
    deletedAt: null,
  };
  return mutation(restored, context, occurredAt, 'restore_nursing_session', session.version, {});
}

/** Projects live totals from persisted counters plus the one open interval. */
export function projectNursingDurations(
  session: NursingSession,
  at: Date,
): NursingDurationProjection {
  assertValidNursingSession(session);
  const projectedAt = toWholeSecond(at);
  let leftDurationSeconds = session.leftDurationSeconds;
  let rightDurationSeconds = session.rightDurationSeconds;
  let pauseDurationSeconds = session.totalPauseDurationSeconds;

  if (session.status === 'active') {
    const accrued = projectedElapsedSeconds(session.activeSideStartedAt, projectedAt);
    if (session.activeSide === 'left') leftDurationSeconds += accrued;
    else rightDurationSeconds += accrued;
  } else if (session.status === 'paused') {
    pauseDurationSeconds += projectedElapsedSeconds(session.pauseStartedAt, projectedAt);
  }

  return {
    leftDurationSeconds,
    rightDurationSeconds,
    pauseDurationSeconds,
    totalDurationSeconds: leftDurationSeconds + rightDurationSeconds,
  };
}

export function assertValidNursingSession(session: NursingSession): void {
  if (!Number.isSafeInteger(session.version) || session.version < 1) {
    throw invalidAggregate('Nursing version must be a positive whole number.');
  }
  assertTimezone(session.timezone);
  if (!isNursingSide(session.lastBreastUsed)) {
    throw invalidAggregate('Nursing requires an explicit last breast.');
  }
  for (const duration of [
    session.leftDurationSeconds,
    session.rightDurationSeconds,
    session.totalPauseDurationSeconds,
  ]) {
    if (!Number.isSafeInteger(duration) || duration < 0) {
      throw invalidAggregate('Nursing durations must be non-negative whole seconds.');
    }
  }
  for (const boundary of [
    session.startedAt,
    session.endedAt,
    session.activeSideStartedAt,
    session.pauseStartedAt,
    session.deletedAt,
  ]) {
    if (boundary !== null && !isWholeSecond(boundary)) {
      throw invalidAggregate('Nursing boundaries must use whole-second UTC instants.');
    }
  }

  if (session.status === 'active') {
    if (
      session.endedAt !== null ||
      session.activeSide === null ||
      session.activeSideStartedAt === null ||
      session.pauseStartedAt !== null ||
      session.lastBreastUsed !== session.activeSide
    ) {
      throw invalidAggregate('Active Nursing requires exactly one open side.');
    }
    if (session.activeSideStartedAt < session.startedAt) {
      throw invalidAggregate('An active side cannot start before Nursing.');
    }
    assertClosedTotalsReach(session, session.activeSideStartedAt);
  } else if (session.status === 'paused') {
    if (
      session.endedAt !== null ||
      session.activeSide !== null ||
      session.activeSideStartedAt !== null ||
      session.pauseStartedAt === null
    ) {
      throw invalidAggregate('Paused Nursing requires exactly one open pause.');
    }
    if (session.pauseStartedAt < session.startedAt) {
      throw invalidAggregate('A pause cannot start before Nursing.');
    }
    assertClosedTotalsReach(session, session.pauseStartedAt);
  } else {
    if (
      session.endedAt === null ||
      session.activeSide !== null ||
      session.activeSideStartedAt !== null ||
      session.pauseStartedAt !== null
    ) {
      throw invalidAggregate('Completed Nursing cannot retain an open side or pause.');
    }
    if (session.endedAt < session.startedAt) {
      throw invalidAggregate('Nursing cannot end before it starts.');
    }
    const elapsed = elapsedSeconds(session.startedAt, session.endedAt);
    if (
      session.leftDurationSeconds +
        session.rightDurationSeconds +
        session.totalPauseDurationSeconds !==
      elapsed
    ) {
      throw invalidAggregate('Completed Nursing totals must equal its elapsed duration.');
    }
  }
}

function assertClosedTotalsReach(session: NursingSession, boundary: UtcInstant): void {
  const closedTotal =
    session.leftDurationSeconds + session.rightDurationSeconds + session.totalPauseDurationSeconds;
  if (closedTotal !== elapsedSeconds(session.startedAt, boundary)) {
    throw invalidAggregate('Stored Nursing totals must reach the open interval boundary.');
  }
}

function assertMutable(session: NursingSession): void {
  assertValidNursingSession(session);
  if (session.deletedAt !== null) {
    throw new NursingError('deleted_session', 'A deleted Nursing session cannot change.');
  }
}

function assertActive(session: NursingSession): asserts session is NursingSession & {
  activeSide: NursingSide;
  activeSideStartedAt: UtcInstant;
  status: 'active';
} {
  assertMutable(session);
  if (session.status !== 'active') {
    throw new NursingError('invalid_transition', 'Only active Nursing can change sides or pause.');
  }
}

function assertPaused(session: NursingSession): asserts session is NursingSession & {
  pauseStartedAt: UtcInstant;
  status: 'paused';
} {
  assertMutable(session);
  if (session.status !== 'paused') {
    throw new NursingError('invalid_transition', 'Only paused Nursing can resume.');
  }
}

function accrueActiveSide(
  session: NursingSession & {
    activeSide: NursingSide;
    activeSideStartedAt: UtcInstant;
  },
  through: UtcInstant,
): NursingSession {
  const accrued = elapsedSeconds(session.activeSideStartedAt, through);
  return session.activeSide === 'left'
    ? { ...session, leftDurationSeconds: session.leftDurationSeconds + accrued }
    : { ...session, rightDurationSeconds: session.rightDurationSeconds + accrued };
}

function effectiveBoundary(
  value: Date,
  occurredAt: UtcInstant,
  openStartedAt?: UtcInstant | null,
): UtcInstant {
  const raw = toUtcInstant(value);
  if (raw > occurredAt) {
    throw new NursingError('future_boundary', 'A Nursing boundary cannot be in the future.');
  }
  const boundary = toWholeSecond(value);
  if (openStartedAt !== undefined && openStartedAt !== null && boundary < openStartedAt) {
    throw new NursingError(
      'transition_before_open_interval',
      'A Nursing transition cannot precede its open side or pause.',
    );
  }
  return boundary;
}

function correctedBoundary(value: Date, occurredAt: UtcInstant): UtcInstant {
  const boundary = toUtcInstant(value);
  if (boundary > occurredAt) {
    throw new NursingError('future_boundary', 'A Nursing boundary cannot be in the future.');
  }
  if (value.getUTCMilliseconds() !== 0) {
    throw invalidCorrection('Corrected Nursing boundaries must use whole-second instants.');
  }
  return boundary;
}

function toWholeSecond(value: Date): UtcInstant {
  const instant = toUtcInstant(value);
  return `${instant.slice(0, 19)}.000Z`;
}

function isWholeSecond(value: UtcInstant): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0);
  } catch {
    throw invalidAggregate('Nursing requires a valid IANA timezone.');
  }
}

function isNursingSide(value: unknown): value is NursingSide {
  return value === 'left' || value === 'right';
}

function elapsedSeconds(startedAt: UtcInstant | null, endedAt: UtcInstant): number {
  if (startedAt === null) throw invalidAggregate('An open Nursing interval requires a start.');
  const elapsed = (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1_000;
  if (!Number.isSafeInteger(elapsed) || elapsed < 0) {
    throw invalidAggregate('Nursing interval boundaries must be ordered whole seconds.');
  }
  return elapsed;
}

function projectedElapsedSeconds(startedAt: UtcInstant | null, at: UtcInstant): number {
  if (startedAt === null) throw invalidAggregate('An open Nursing interval requires a start.');
  const elapsed = (new Date(at).getTime() - new Date(startedAt).getTime()) / 1_000;
  return Number.isSafeInteger(elapsed) ? Math.max(0, elapsed) : 0;
}

function mutation(
  session: NursingSession,
  context: MutationContext,
  occurredAt: UtcInstant,
  action: NursingAction,
  baseVersion: number | null,
  payload: Readonly<Record<string, JsonValue>>,
): NursingMutation {
  return {
    session,
    operation: {
      operationId: context.newId(),
      entityId: session.id,
      entityType: 'nursing_session',
      action,
      baseVersion,
      clientOccurredAt: occurredAt,
      clientTimezone: context.timezone,
      payload,
    },
  };
}

function invalidAggregate(message: string): NursingError {
  return new NursingError('invalid_aggregate', message);
}

function invalidCorrection(message: string): NursingError {
  return new NursingError('invalid_correction', message);
}
