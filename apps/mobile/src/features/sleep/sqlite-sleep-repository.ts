import {
  assertValidSleepSession,
  type NapSession,
  type NightSleepSession,
  type SleepMutation,
  type SleepPhase,
  type SleepSession,
  type SleepSessionKind,
} from '@baby-tracker/domain';
import type { SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';

interface SleepRow {
  id: string;
  child_id: string;
  kind: SleepSessionKind;
  started_at: string;
  ended_at: string | null;
  status: 'active' | 'completed';
  timezone: string;
  created_by: string;
  updated_by: string;
  version: number;
  deleted_at: string | null;
  phase_id: string;
  phase_started_at: string;
  phase_ended_at: string | null;
  phase_kind: 'asleep' | 'awake';
  phase_created_by: string;
  phase_updated_by: string;
  phase_version: number;
  phase_deleted_at: string | null;
}

interface StoredPhaseRow {
  id: string;
  sleep_session_id: string;
  kind: 'asleep' | 'awake';
  started_at: string;
  ended_at: string | null;
  created_by: string;
  updated_by: string;
  version: number;
  deleted_at: string | null;
  retired_at: string | null;
}

const SELECT_SLEEP = `
  SELECT
    session.id,
    session.child_id,
    session.kind,
    session.started_at,
    session.ended_at,
    session.status,
    session.timezone,
    session.created_by,
    session.updated_by,
    session.version,
    session.deleted_at,
    phase.id AS phase_id,
    phase.started_at AS phase_started_at,
    phase.ended_at AS phase_ended_at,
    phase.kind AS phase_kind,
    phase.created_by AS phase_created_by,
    phase.updated_by AS phase_updated_by,
    phase.version AS phase_version,
    phase.deleted_at AS phase_deleted_at
  FROM sleep_sessions AS session
  INNER JOIN sleep_phases AS phase ON phase.sleep_session_id = session.id AND phase.retired_at IS NULL
`;

export class SQLiteSleepRepository {
  public constructor(private readonly database: SQLiteDatabase) {}

  public async active(childId: string): Promise<SleepSession | null> {
    const rows = await this.database.getAllAsync<SleepRow>(
      `${SELECT_SLEEP}
       WHERE session.child_id = ?
         AND session.status = 'active'
         AND session.deleted_at IS NULL
       ORDER BY phase.started_at, phase.id`,
      childId,
    );
    return rows.length === 0 ? null : mapOneSession(rows);
  }

  public async activeNight(childId: string): Promise<NightSleepSession | null> {
    const active = await this.active(childId);
    return active?.kind === 'night' ? active : null;
  }

  public async findById(sessionId: string): Promise<SleepSession | null> {
    const rows = await this.database.getAllAsync<SleepRow>(
      `${SELECT_SLEEP}
       WHERE session.id = ?
       ORDER BY phase.started_at, phase.id`,
      sessionId,
    );
    return rows.length === 0 ? null : mapOneSession(rows);
  }

  public async latestCompletedEnd(
    childId: string,
    kind?: SleepSessionKind,
  ): Promise<string | null> {
    const kindClause = kind === undefined ? '' : 'AND kind = ?';
    const parameters = kind === undefined ? [childId] : [childId, kind];
    const row = await this.database.getFirstAsync<{ ended_at: string | null }>(
      `SELECT MAX(ended_at) AS ended_at
       FROM sleep_sessions
       WHERE child_id = ?
         AND status = 'completed'
         AND deleted_at IS NULL
         ${kindClause}`,
      ...parameters,
    );
    return row?.ended_at ?? null;
  }

  public async listVisible(
    childId: string,
    dayStartedAt: string,
    nextDayStartedAt: string,
    kind?: SleepSessionKind,
  ): Promise<SleepSession[]> {
    const kindClause = kind === undefined ? '' : 'AND session.kind = ?';
    const parameters =
      kind === undefined
        ? [childId, nextDayStartedAt, dayStartedAt]
        : [childId, nextDayStartedAt, dayStartedAt, kind];
    const rows = await this.database.getAllAsync<SleepRow>(
      `${SELECT_SLEEP}
       WHERE session.child_id = ?
         AND session.deleted_at IS NULL
         AND session.started_at < ?
         AND (session.ended_at IS NULL OR session.ended_at > ?)
         ${kindClause}
       ORDER BY session.started_at DESC, phase.started_at, phase.id`,
      ...parameters,
    );
    return mapSessions(rows);
  }

  public async save(mutation: SleepMutation): Promise<void> {
    assertValidSleepSession(mutation.session);
    assertMutationRootSemantics(mutation);
    assertChangedPhasesMatchAggregate(mutation);

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await assertPhaseChangesMatchStorage(transaction, mutation);
      await assertNoOtherActiveSession(transaction, mutation.session);
      await assertNoOverlap(transaction, mutation.session);

      const sessionResult = await upsertSession(
        transaction,
        mutation.session,
        mutation.operation.baseVersion,
      );
      if (sessionResult.changes === 0) throw new SleepWriteConflictError();

      // Close/tombstone the former open phase before opening its replacement.
      const orderedChanges = [...mutation.changedPhases].sort(
        (a, b) =>
          Number(a.endedAt === null && a.deletedAt === null) -
          Number(b.endedAt === null && b.deletedAt === null),
      );
      const retiredIds = new Set(mutation.retiredPhases?.map(({ id }) => id));
      for (const phase of orderedChanges) {
        const phaseResult = await upsertPhase(transaction, phase, retiredIds.has(phase.id));
        if (phaseResult.changes === 0) throw new SleepWriteConflictError();
      }

      await transaction.runAsync(
        `INSERT INTO outbox_operations (
          operation_id, entity_id, entity_type, action, base_version,
          client_occurred_at, client_timezone, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        mutation.operation.operationId,
        mutation.operation.entityId,
        mutation.operation.entityType,
        mutation.operation.action,
        mutation.operation.baseVersion,
        mutation.operation.clientOccurredAt,
        mutation.operation.clientTimezone,
        JSON.stringify(mutation.operation.payload),
        new Date().toISOString(),
      );
    });
  }

  public async pendingOperationCount(): Promise<number> {
    const row = await this.database.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM outbox_operations WHERE state = 'pending'",
    );
    return row?.count ?? 0;
  }
}

export class SleepWriteConflictError extends Error {
  public constructor() {
    super('This sleep session changed before your update was saved. Refresh and try again.');
    this.name = 'SleepWriteConflictError';
  }
}

export class ActiveSleepSessionError extends Error {
  public constructor() {
    super('Another sleep session is already active for this child.');
    this.name = 'ActiveSleepSessionError';
  }
}

export class SleepOverlapError extends Error {
  public constructor() {
    super('This sleep session overlaps existing sleep history. Adjust its start or end time.');
    this.name = 'SleepOverlapError';
  }
}

async function assertNoOtherActiveSession(
  transaction: SQLiteDatabase,
  session: SleepSession,
): Promise<void> {
  if (session.deletedAt !== null || session.status !== 'active') return;
  const row = await transaction.getFirstAsync<{ id: string }>(
    `SELECT id FROM sleep_sessions
     WHERE child_id = ? AND id <> ? AND status = 'active' AND deleted_at IS NULL
     LIMIT 1`,
    session.childId,
    session.id,
  );
  if (row !== null) throw new ActiveSleepSessionError();
}

async function assertNoOverlap(transaction: SQLiteDatabase, session: SleepSession): Promise<void> {
  if (session.deletedAt !== null) return;
  const row = await transaction.getFirstAsync<{ id: string }>(
    `SELECT id FROM sleep_sessions
     WHERE child_id = ?
       AND id <> ?
       AND deleted_at IS NULL
       AND (? IS NULL OR started_at < ?)
       AND (ended_at IS NULL OR ended_at > ?)
     LIMIT 1`,
    session.childId,
    session.id,
    session.endedAt,
    session.endedAt,
    session.startedAt,
  );
  if (row !== null) throw new SleepOverlapError();
}

async function upsertSession(
  transaction: SQLiteDatabase,
  session: SleepSession,
  expectedVersion: number | null,
): Promise<SQLiteRunResult> {
  return transaction.runAsync(
    `INSERT INTO sleep_sessions (
      id, child_id, kind, started_at, ended_at, status, timezone,
      created_by, updated_by, version, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      status = excluded.status,
      updated_by = excluded.updated_by,
      version = excluded.version,
      deleted_at = excluded.deleted_at
    WHERE sleep_sessions.version = ?`,
    session.id,
    session.childId,
    session.kind,
    session.startedAt,
    session.endedAt,
    session.status,
    session.timezone,
    session.createdBy,
    session.updatedBy,
    session.version,
    session.deletedAt,
    expectedVersion,
  );
}

async function upsertPhase(
  transaction: SQLiteDatabase,
  phase: SleepPhase,
  retired: boolean,
): Promise<SQLiteRunResult> {
  return transaction.runAsync(
    `INSERT INTO sleep_phases (
      id, sleep_session_id, kind, started_at, ended_at,
      created_by, updated_by, version, deleted_at, retired_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      updated_by = excluded.updated_by,
      version = excluded.version,
      deleted_at = excluded.deleted_at
      , retired_at = excluded.retired_at
    WHERE sleep_phases.version = ?`,
    phase.id,
    phase.sleepSessionId,
    phase.kind,
    phase.startedAt,
    phase.endedAt,
    phase.createdBy,
    phase.updatedBy,
    phase.version,
    phase.deletedAt,
    retired ? phase.deletedAt : null,
    phase.version - 1,
  );
}

function assertMutationRootSemantics(mutation: SleepMutation): void {
  const expectedBaseVersion = mutation.session.version === 1 ? null : mutation.session.version - 1;
  if (
    mutation.operation.entityId !== mutation.session.id ||
    mutation.operation.entityType !== 'sleep_session' ||
    mutation.operation.baseVersion !== expectedBaseVersion
  ) {
    throw new Error('A sleep mutation must target its aggregate root and advance one version.');
  }
}

function assertChangedPhasesMatchAggregate(mutation: SleepMutation): void {
  const retired = mutation.retiredPhases ?? [];
  if (
    retired.length > 0 &&
    (mutation.operation.action !== 'delete_night_waking' ||
      mutation.session.kind !== 'night' ||
      retired.some(
        (phase) =>
          phase.deletedAt !== mutation.operation.clientOccurredAt ||
          mutation.session.phases.some(({ id }) => id === phase.id),
      ))
  )
    throw new Error('Only waking deletion can retire canonical Night phases.');
  const allPhases = [...mutation.session.phases, ...retired];
  const aggregatePhases = new Map(allPhases.map((phase) => [phase.id, phase]));
  if (aggregatePhases.size !== allPhases.length) throw new Error('Duplicate phase identity.');
  const changedIds = new Set(mutation.changedPhases.map((phase) => phase.id));
  if (mutation.changedPhases.length === 0 || changedIds.size !== mutation.changedPhases.length) {
    throw new Error('A sleep mutation must identify each changed phase exactly once.');
  }
  for (const changedPhase of mutation.changedPhases) {
    const aggregatePhase = aggregatePhases.get(changedPhase.id);
    if (
      changedPhase.sleepSessionId !== mutation.session.id ||
      aggregatePhase === undefined ||
      !phasesEqual(changedPhase, aggregatePhase)
    ) {
      throw new Error('Changed phases must exactly match their aggregate representation.');
    }
  }
}

async function assertPhaseChangesMatchStorage(
  transaction: SQLiteDatabase,
  mutation: SleepMutation,
): Promise<void> {
  const rows = await transaction.getAllAsync<StoredPhaseRow>(
    `SELECT id, sleep_session_id, kind, started_at, ended_at,
            created_by, updated_by, version, deleted_at, retired_at
     FROM sleep_phases
     WHERE sleep_session_id = ?`,
    mutation.session.id,
  );
  const storedPhases = new Map(rows.map((row) => [row.id, mapStoredPhase(row)]));
  const allPhases = [...mutation.session.phases, ...(mutation.retiredPhases ?? [])];
  const aggregateIds = new Set(allPhases.map((phase) => phase.id));
  if (rows.some((row) => row.retired_at === null && !aggregateIds.has(row.id))) {
    throw new Error('A sleep mutation cannot omit persisted aggregate phases.');
  }

  const retiredIds = new Set(mutation.retiredPhases?.map(({ id }) => id));
  for (const row of rows) {
    if (
      row.retired_at !== null &&
      aggregateIds.has(row.id) &&
      mutation.operation.action !== 'restore_night_waking'
    ) {
      throw new Error('Only waking Undo can restore a retired phase.');
    }
  }
  for (const id of retiredIds) {
    if (!rows.some((row) => row.id === id && row.retired_at === null && row.deleted_at === null)) {
      throw new SleepWriteConflictError();
    }
  }
  const requiredChanges = new Set<string>();
  for (const phase of allPhases) {
    const stored = storedPhases.get(phase.id);
    if (stored === undefined) {
      if (phase.version !== 1) {
        throw new SleepWriteConflictError();
      }
      requiredChanges.add(phase.id);
    } else if (!phasesEqual(phase, stored)) {
      if (phase.version !== stored.version + 1) {
        throw new SleepWriteConflictError();
      }
      requiredChanges.add(phase.id);
    }
  }

  const declaredChanges = new Set(mutation.changedPhases.map((phase) => phase.id));
  if (
    requiredChanges.size !== declaredChanges.size ||
    [...requiredChanges].some((id) => !declaredChanges.has(id))
  ) {
    throw new Error('A sleep mutation must declare every and only changed aggregate phase.');
  }
}

function mapStoredPhase(row: StoredPhaseRow): SleepPhase {
  return {
    id: row.id,
    sleepSessionId: row.sleep_session_id,
    kind: row.kind,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    version: row.version,
    deletedAt: row.deleted_at,
  };
}

function phasesEqual(left: SleepPhase, right: SleepPhase): boolean {
  return (
    left.id === right.id &&
    left.sleepSessionId === right.sleepSessionId &&
    left.kind === right.kind &&
    left.startedAt === right.startedAt &&
    left.endedAt === right.endedAt &&
    left.createdBy === right.createdBy &&
    left.updatedBy === right.updatedBy &&
    left.version === right.version &&
    left.deletedAt === right.deletedAt
  );
}

function mapSessions(rows: readonly SleepRow[]): SleepSession[] {
  const grouped = new Map<string, SleepRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.id);
    if (group === undefined) grouped.set(row.id, [row]);
    else group.push(row);
  }
  return [...grouped.values()].map(mapOneSession);
}

function mapOneSession(rows: readonly SleepRow[]): SleepSession {
  const row = rows[0];
  if (row === undefined) throw new Error('Cannot map a sleep session without rows.');
  const phases = rows.map(mapPhase).sort(comparePhases);
  const base = {
    id: row.id,
    childId: row.child_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    timezone: row.timezone,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    version: row.version,
    deletedAt: row.deleted_at,
  };
  let session: SleepSession;
  if (row.kind === 'nap') {
    if (phases.length !== 1) throw new Error('Stored Nap must have exactly one phase.');
    session = { ...base, kind: 'nap', phases: [phases[0]] } satisfies NapSession;
  } else {
    session = { ...base, kind: 'night', phases } satisfies NightSleepSession;
  }
  assertValidSleepSession(session);
  return session;
}

function mapPhase(row: SleepRow): SleepPhase {
  return {
    id: row.phase_id,
    sleepSessionId: row.id,
    kind: row.phase_kind,
    startedAt: row.phase_started_at,
    endedAt: row.phase_ended_at,
    createdBy: row.phase_created_by,
    updatedBy: row.phase_updated_by,
    version: row.phase_version,
    deletedAt: row.phase_deleted_at,
  };
}

function comparePhases(left: SleepPhase, right: SleepPhase): number {
  return left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id);
}
