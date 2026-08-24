import { toUtcInstant } from './time';
import type {
  MutationContext,
  JsonValue,
  NightSleepMutation,
  NightSleepSession,
  SleepMutation,
  SleepPhase,
  SleepPhaseKind,
  SleepSession,
  SyncAction,
  UtcInstant,
} from './types';

export type SleepTransitionErrorCode =
  | 'deleted_session'
  | 'future_transition'
  | 'invalid_aggregate'
  | 'invalid_transition'
  | 'not_active_night'
  | 'transition_not_after_phase_start';

export class SleepTransitionError extends Error {
  public constructor(
    public readonly code: SleepTransitionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SleepTransitionError';
  }
}

export interface SleepPhaseBoundary {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
}

/** Creates a Night session and its first asleep phase (Bedtime). */
export function startNightSleep(
  context: MutationContext,
  startedAt: Date = context.now,
): NightSleepMutation {
  const occurredAt = toUtcInstant(context.now);
  const selectedStartedAt = transitionInstant(startedAt, occurredAt);
  const sessionId = context.newId();
  const phase = createPhase(sessionId, 'asleep', selectedStartedAt, context);
  const session: NightSleepSession = {
    id: sessionId,
    childId: context.childId,
    kind: 'night',
    startedAt: selectedStartedAt,
    endedAt: null,
    status: 'active',
    timezone: context.timezone,
    createdBy: context.caregiverId,
    updatedBy: context.caregiverId,
    version: 1,
    deletedAt: null,
    phases: [phase],
  };

  assertValidSleepSession(session);
  return mutation(session, [phase], context, occurredAt, 'start_night_sleep', null, {
    startedAt: selectedStartedAt,
    phaseId: phase.id,
  });
}

/** Closes the active asleep phase and opens an awake phase (Night waking). */
export function startNightWaking(
  session: NightSleepSession,
  context: MutationContext,
  startedAt: Date = context.now,
): NightSleepMutation {
  return appendPhase(session, 'asleep', 'awake', 'start_night_waking', context, startedAt);
}

/** Closes the active awake phase and opens a new asleep phase. */
export function resumeNightSleep(
  session: NightSleepSession,
  context: MutationContext,
  startedAt: Date = context.now,
): NightSleepMutation {
  return appendPhase(session, 'awake', 'asleep', 'resume_night_sleep', context, startedAt);
}

/** Closes the open phase and containing Night session, from either phase kind (Wake up). */
export function endNightSleep(
  session: NightSleepSession,
  context: MutationContext,
  endedAt: Date = context.now,
): NightSleepMutation {
  const openPhase = activeNightPhase(session);
  const occurredAt = toUtcInstant(context.now);
  const selectedEndedAt = transitionInstant(endedAt, occurredAt, openPhase.startedAt);
  const closedPhase: SleepPhase = {
    ...openPhase,
    endedAt: selectedEndedAt,
    updatedBy: context.caregiverId,
    version: openPhase.version + 1,
  };
  const phases = replacePhase(session.phases, closedPhase);
  const completed: NightSleepSession = {
    ...session,
    endedAt: selectedEndedAt,
    status: 'completed',
    updatedBy: context.caregiverId,
    version: session.version + 1,
    phases,
  };

  assertValidSleepSession(completed);
  return mutation(
    completed,
    [closedPhase],
    context,
    occurredAt,
    'end_night_sleep',
    session.version,
    {
      endedAt: selectedEndedAt,
      closedPhaseId: closedPhase.id,
    },
  );
}

/**
 * Replaces every Night phase boundary as one versioned aggregate edit.
 * The aggregate validator rejects gaps, overlaps, non-alternating phases, and invalid session bounds.
 */
export function editNightSleep(
  session: NightSleepSession,
  boundaries: readonly SleepPhaseBoundary[],
  context: MutationContext,
): NightSleepMutation {
  assertNotDeleted(session);
  if (boundaries.length !== session.phases.length) {
    throw invalidAggregate('A Night edit must preserve the existing phase identities.');
  }

  const occurredAt = toUtcInstant(context.now);
  const byId = new Map(boundaries.map((boundary) => [boundary.id, boundary]));
  const phases = session.phases.map((phase) => {
    const boundary = byId.get(phase.id);
    if (boundary === undefined) {
      throw invalidAggregate('A Night edit must preserve the existing phase identities.');
    }
    const startedAt = transitionInstant(boundary.startedAt, occurredAt);
    const endedAt =
      boundary.endedAt === null ? null : transitionInstant(boundary.endedAt, occurredAt, startedAt);
    return {
      ...phase,
      startedAt,
      endedAt,
      updatedBy: context.caregiverId,
      version: phase.version + 1,
    };
  });
  if (byId.size !== session.phases.length) {
    throw invalidAggregate('A Night edit must preserve the existing phase identities.');
  }

  const firstPhase = phases[0];
  const lastPhase = phases.at(-1);
  if (firstPhase === undefined || lastPhase === undefined) {
    throw invalidAggregate('A Night session requires at least one phase.');
  }
  const edited: NightSleepSession = {
    ...session,
    startedAt: firstPhase.startedAt,
    endedAt: session.status === 'completed' ? lastPhase.endedAt : null,
    updatedBy: context.caregiverId,
    version: session.version + 1,
    phases,
  };

  assertValidSleepSession(edited);
  return mutation(edited, phases, context, occurredAt, 'edit_sleep_session', session.version, {
    phases: phases.map(({ id, startedAt, endedAt }) => ({ id, startedAt, endedAt })),
  });
}

/** Validates the persisted Sleep aggregate independently of UI or storage frameworks. */
export function assertValidSleepSession(session: SleepSession): void {
  if (session.phases.length === 0) {
    throw invalidAggregate('A sleep session requires at least one phase.');
  }
  if (session.version < 1) throw invalidAggregate('A sleep session version must be positive.');

  const phaseIds = new Set(session.phases.map((phase) => phase.id));
  if (phaseIds.size !== session.phases.length) {
    throw invalidAggregate('Sleep phase identifiers must be unique within their session.');
  }

  if (session.kind === 'nap') {
    if (session.phases.length !== 1) {
      throw invalidAggregate('A Nap must have exactly one phase.');
    }
    const phase = session.phases[0];
    if (phase.kind !== 'asleep') throw invalidAggregate('A Nap phase must be asleep.');
    if (phase.startedAt !== session.startedAt || phase.endedAt !== session.endedAt) {
      throw invalidAggregate('A Nap phase must match its session bounds.');
    }
  }

  let previous: SleepPhase | undefined;
  for (const phase of session.phases) {
    if (phase.sleepSessionId !== session.id) {
      throw invalidAggregate('Every phase must belong to its containing sleep session.');
    }
    if (phase.deletedAt !== session.deletedAt) {
      throw invalidAggregate('Session and phase tombstones must be consistent.');
    }
    if (phase.version < 1) throw invalidAggregate('A sleep phase version must be positive.');
    if (phase.startedAt < session.startedAt) {
      throw invalidAggregate('A sleep phase cannot start before its session.');
    }
    if (phase.endedAt !== null && phase.endedAt <= phase.startedAt) {
      throw invalidAggregate('A sleep phase must end after it starts.');
    }
    if (previous !== undefined) {
      if (previous.endedAt !== phase.startedAt) {
        throw invalidAggregate('Night phases must be contiguous and ordered.');
      }
      if (previous.kind === phase.kind) {
        throw invalidAggregate('Night phases must alternate asleep and awake.');
      }
    }
    previous = phase;
  }

  const first = session.phases[0];
  const last = session.phases.at(-1);
  if (first.startedAt !== session.startedAt || last === undefined) {
    throw invalidAggregate('Sleep session bounds must match its phases.');
  }
  if (session.kind === 'night' && first.kind !== 'asleep') {
    throw invalidAggregate('A Night session must begin asleep.');
  }
  const openPhases = session.phases.filter((phase) => phase.endedAt === null);
  if (session.status === 'active') {
    if (session.endedAt !== null || openPhases.length !== 1 || last.endedAt !== null) {
      throw invalidAggregate('An active sleep session requires exactly one final open phase.');
    }
  } else if (
    session.endedAt === null ||
    openPhases.length !== 0 ||
    last.endedAt !== session.endedAt
  ) {
    throw invalidAggregate('A completed sleep session requires closed session and phase bounds.');
  }
}

function appendPhase(
  session: NightSleepSession,
  expectedKind: SleepPhaseKind,
  nextKind: SleepPhaseKind,
  action: 'start_night_waking' | 'resume_night_sleep',
  context: MutationContext,
  transitionAt: Date,
): NightSleepMutation {
  const openPhase = activeNightPhase(session);
  if (openPhase.kind !== expectedKind) {
    throw new SleepTransitionError(
      'invalid_transition',
      expectedKind === 'asleep'
        ? 'Night waking can only start while the child is asleep.'
        : 'Night sleep can only resume while the child is awake.',
    );
  }

  const occurredAt = toUtcInstant(context.now);
  const selectedTransitionAt = transitionInstant(transitionAt, occurredAt, openPhase.startedAt);
  const closedPhase: SleepPhase = {
    ...openPhase,
    endedAt: selectedTransitionAt,
    updatedBy: context.caregiverId,
    version: openPhase.version + 1,
  };
  const nextPhase = createPhase(session.id, nextKind, selectedTransitionAt, context);
  const phases = [...replacePhase(session.phases, closedPhase), nextPhase];
  const updated: NightSleepSession = {
    ...session,
    updatedBy: context.caregiverId,
    version: session.version + 1,
    phases,
  };

  assertValidSleepSession(updated);
  return mutation(updated, [closedPhase, nextPhase], context, occurredAt, action, session.version, {
    transitionAt: selectedTransitionAt,
    closedPhaseId: closedPhase.id,
    openedPhaseId: nextPhase.id,
  });
}

function activeNightPhase(session: NightSleepSession): SleepPhase {
  assertNotDeleted(session);
  assertValidSleepSession(session);
  if (session.status !== 'active' || session.endedAt !== null) {
    throw new SleepTransitionError(
      'not_active_night',
      'Only an active Night session can transition.',
    );
  }
  const phase = session.phases.at(-1);
  if (phase === undefined || phase.endedAt !== null) {
    throw new SleepTransitionError(
      'not_active_night',
      'An active Night session must have one open phase.',
    );
  }
  return phase;
}

function assertNotDeleted(session: NightSleepSession): void {
  if (session.deletedAt !== null) {
    throw new SleepTransitionError('deleted_session', 'A deleted Night session cannot change.');
  }
}

function transitionInstant(value: Date, occurredAt: UtcInstant, after?: UtcInstant): UtcInstant {
  const instant = toUtcInstant(value);
  if (instant > occurredAt) {
    throw new SleepTransitionError(
      'future_transition',
      'A sleep transition cannot be in the future.',
    );
  }
  if (after !== undefined && instant <= after) {
    throw new SleepTransitionError(
      'transition_not_after_phase_start',
      'A sleep transition must occur after the open phase starts.',
    );
  }
  return instant;
}

function createPhase(
  sessionId: string,
  kind: SleepPhaseKind,
  startedAt: UtcInstant,
  context: MutationContext,
): SleepPhase {
  return {
    id: context.newId(),
    sleepSessionId: sessionId,
    kind,
    startedAt,
    endedAt: null,
    createdBy: context.caregiverId,
    updatedBy: context.caregiverId,
    version: 1,
    deletedAt: null,
  };
}

function replacePhase(phases: readonly SleepPhase[], replacement: SleepPhase): SleepPhase[] {
  return phases.map((phase) => (phase.id === replacement.id ? replacement : phase));
}

function mutation<TSession extends SleepSession>(
  session: TSession,
  changedPhases: readonly SleepPhase[],
  context: MutationContext,
  occurredAt: UtcInstant,
  action: SyncAction,
  baseVersion: number | null,
  payload: Readonly<Record<string, JsonValue>>,
): SleepMutation<TSession> {
  return {
    session,
    changedPhases,
    operation: {
      operationId: context.newId(),
      entityId: session.id,
      entityType: 'sleep_session',
      action,
      baseVersion,
      clientOccurredAt: occurredAt,
      clientTimezone: context.timezone,
      payload,
    },
  };
}

function invalidAggregate(message: string): SleepTransitionError {
  return new SleepTransitionError('invalid_aggregate', message);
}
