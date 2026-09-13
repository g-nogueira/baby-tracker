import {
  assertValidNursingSession,
  editActiveNursing,
  correctedNursingLastBreast,
  type JsonValue,
  type NursingMutation,
  type NursingSession,
  type NursingSide,
} from '@baby-tracker/domain';
import type { SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';

interface NursingRow {
  id: string;
  child_id: string;
  started_at: string;
  ended_at: string | null;
  status: 'active' | 'paused' | 'completed';
  left_duration_seconds: number;
  right_duration_seconds: number;
  total_pause_duration_seconds: number;
  active_side: NursingSide | null;
  active_side_started_at: string | null;
  pause_started_at: string | null;
  last_breast_used: NursingSide;
  timezone: string;
  created_by: string;
  updated_by: string;
  version: number;
  deleted_at: string | null;
}

const SELECT_NURSING = `
  SELECT
    id, child_id, started_at, ended_at, status,
    left_duration_seconds, right_duration_seconds, total_pause_duration_seconds,
    active_side, active_side_started_at, pause_started_at, last_breast_used,
    timezone, created_by, updated_by, version, deleted_at
  FROM nursing_sessions
`;

export class SQLiteNursingRepository {
  public constructor(private readonly database: SQLiteDatabase) {}

  public async active(childId: string): Promise<NursingSession | null> {
    const row = await this.database.getFirstAsync<NursingRow>(
      `${SELECT_NURSING}
       WHERE child_id = ?
         AND status IN ('active', 'paused')
         AND deleted_at IS NULL
       LIMIT 1`,
      childId,
    );
    return row === null ? null : mapSession(row);
  }

  public async findById(sessionId: string): Promise<NursingSession | null> {
    const row = await this.database.getFirstAsync<NursingRow>(
      `${SELECT_NURSING} WHERE id = ?`,
      sessionId,
    );
    return row === null ? null : mapSession(row);
  }

  public async listVisible(
    childId: string,
    dayStartedAt: string,
    nextDayStartedAt: string,
  ): Promise<NursingSession[]> {
    const rows = await this.database.getAllAsync<NursingRow>(
      `${SELECT_NURSING}
       WHERE child_id = ?
         AND deleted_at IS NULL
         AND started_at < ?
         AND (ended_at IS NULL OR ended_at > ?)
       ORDER BY started_at DESC, id DESC`,
      childId,
      nextDayStartedAt,
      dayStartedAt,
    );
    return rows.map(mapSession);
  }

  public async latestCompletedLastBreast(childId: string): Promise<NursingSide | null> {
    const row = await this.database.getFirstAsync<{ last_breast_used: NursingSide }>(
      `SELECT last_breast_used
       FROM nursing_sessions
       WHERE child_id = ?
         AND status = 'completed'
         AND deleted_at IS NULL
       ORDER BY ended_at DESC, started_at DESC, id DESC
       LIMIT 1`,
      childId,
    );
    return row?.last_breast_used ?? null;
  }

  public async save(mutation: NursingMutation): Promise<void> {
    assertValidNursingSession(mutation.session);
    assertOperationSemantics(mutation);

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await assertStoredRootSemantics(transaction, mutation);
      await assertNoOtherOpenNursing(transaction, mutation.session);
      const result = await upsertSession(
        transaction,
        mutation.session,
        mutation.operation.baseVersion,
      );
      if (result.changes === 0) throw new NursingWriteConflictError();

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

export class NursingWriteConflictError extends Error {
  public constructor() {
    super('This Nursing session changed before your update was saved. Refresh and try again.');
    this.name = 'NursingWriteConflictError';
  }
}

export class ActiveNursingSessionError extends Error {
  public constructor() {
    super('Another Nursing session is already active or paused for this child.');
    this.name = 'ActiveNursingSessionError';
  }
}

function assertOperationSemantics(mutation: NursingMutation): void {
  const expectedBaseVersion = mutation.session.version === 1 ? null : mutation.session.version - 1;
  if (
    mutation.operation.entityId !== mutation.session.id ||
    mutation.operation.entityType !== 'nursing_session' ||
    mutation.operation.baseVersion !== expectedBaseVersion
  ) {
    throw new Error('A Nursing mutation must target its aggregate root and advance one version.');
  }

  const creating = mutation.operation.baseVersion === null;
  if (
    (creating && mutation.operation.action !== 'start_nursing') ||
    (!creating && mutation.operation.action === 'start_nursing')
  ) {
    throw new Error('Only a new Nursing aggregate can use the start action.');
  }
  if (creating && (mutation.session.status !== 'active' || mutation.session.deletedAt !== null)) {
    throw new Error('A new Nursing aggregate must begin as an active, visible session.');
  }
  if (
    mutation.operation.action === 'edit_nursing_session' &&
    (mutation.session.status !== 'completed' || mutation.session.deletedAt !== null)
  ) {
    throw new Error('A Nursing edit must keep a completed session visible.');
  }
  if (
    mutation.operation.action === 'delete_nursing_session' &&
    (mutation.session.status !== 'completed' || mutation.session.deletedAt === null)
  ) {
    throw new Error('A Nursing delete must produce a completed tombstone.');
  }
  if (
    mutation.operation.action === 'restore_nursing_session' &&
    (mutation.session.status !== 'completed' || mutation.session.deletedAt !== null)
  ) {
    throw new Error('A Nursing restore must produce a visible completed session.');
  }
  if (
    mutation.session.deletedAt !== null &&
    mutation.operation.action !== 'delete_nursing_session'
  ) {
    throw new Error('Only the Nursing delete action can produce a tombstone.');
  }
  assertOperationPayload(mutation);
}

async function assertStoredRootSemantics(
  transaction: SQLiteDatabase,
  mutation: NursingMutation,
): Promise<void> {
  const storedRow = await transaction.getFirstAsync<NursingRow>(
    `${SELECT_NURSING} WHERE id = ?`,
    mutation.session.id,
  );
  const baseVersion = mutation.operation.baseVersion;
  if (baseVersion === null) {
    if (storedRow !== null) throw new NursingWriteConflictError();
    return;
  }
  if (storedRow === null || storedRow.version !== baseVersion) {
    throw new NursingWriteConflictError();
  }
  const stored = mapSession(storedRow);
  if (
    stored.childId !== mutation.session.childId ||
    stored.timezone !== mutation.session.timezone ||
    stored.createdBy !== mutation.session.createdBy
  ) {
    throw new Error('A Nursing update cannot change immutable aggregate ownership fields.');
  }
  assertStoredActionTransition(stored, mutation);
}

function assertStoredActionTransition(stored: NursingSession, mutation: NursingMutation): void {
  const storedIsVisible = stored.deletedAt === null;
  const currentIsVisible = mutation.session.deletedAt === null;
  const valid = (() => {
    switch (mutation.operation.action) {
      case 'switch_nursing_side':
        return (
          storedIsVisible &&
          currentIsVisible &&
          stored.status === 'active' &&
          mutation.session.status === 'active'
        );
      case 'pause_nursing':
        return (
          storedIsVisible &&
          currentIsVisible &&
          stored.status === 'active' &&
          mutation.session.status === 'paused'
        );
      case 'resume_nursing':
        return (
          storedIsVisible &&
          currentIsVisible &&
          stored.status === 'paused' &&
          mutation.session.status === 'active'
        );
      case 'stop_nursing':
        return (
          storedIsVisible &&
          currentIsVisible &&
          stored.status !== 'completed' &&
          mutation.session.status === 'completed'
        );
      case 'edit_active_nursing':
        return (
          storedIsVisible &&
          currentIsVisible &&
          stored.status !== 'completed' &&
          stored.status === mutation.session.status
        );
      case 'edit_nursing_session':
        return (
          storedIsVisible &&
          currentIsVisible &&
          stored.status === 'completed' &&
          mutation.session.status === 'completed'
        );
      case 'delete_nursing_session':
        return (
          storedIsVisible &&
          !currentIsVisible &&
          stored.status === 'completed' &&
          mutation.session.status === 'completed'
        );
      case 'restore_nursing_session':
        return (
          !storedIsVisible &&
          currentIsVisible &&
          stored.status === 'completed' &&
          mutation.session.status === 'completed'
        );
      case 'start_nursing':
        return false;
    }
  })();

  if (!valid) {
    throw new Error('The Nursing action does not match the stored lifecycle transition.');
  }

  if (mutation.operation.action === 'edit_active_nursing') {
    const snapshot = mutation.operation.payload.snapshotAt;
    if (typeof snapshot !== 'string')
      throw new Error('A live Nursing edit requires its snapshot time.');
    const expected = editActiveNursing(
      stored,
      {
        startedAt: new Date(mutation.session.startedAt),
        snapshotAt: new Date(snapshot),
        leftDurationSeconds: mutation.session.leftDurationSeconds,
      },
      {
        caregiverId: mutation.session.updatedBy,
        childId: stored.childId,
        timezone: mutation.operation.clientTimezone,
        now: new Date(mutation.operation.clientOccurredAt),
        newId: () => mutation.operation.operationId,
      },
    );
    if (
      !sameNursingBusinessFields(expected.session, mutation.session) ||
      !jsonRecordsEqual(expected.operation.payload, mutation.operation.payload)
    ) {
      throw new Error('A live Nursing edit must preserve the running side and pause time.');
    }
  }

  if (mutation.operation.action === 'edit_nursing_session') {
    if (mutation.session.totalPauseDurationSeconds !== stored.totalPauseDurationSeconds) {
      throw new Error('A Nursing edit must preserve the stored pause duration.');
    }
    const expectedLastBreast = correctedNursingLastBreast(
      stored.lastBreastUsed,
      mutation.session.leftDurationSeconds,
      mutation.session.rightDurationSeconds,
    );
    if (mutation.session.lastBreastUsed !== expectedLastBreast) {
      throw new Error('A Nursing edit must preserve or deterministically correct Last.');
    }
  }

  if (
    (mutation.operation.action === 'delete_nursing_session' ||
      mutation.operation.action === 'restore_nursing_session') &&
    !sameNursingBusinessFields(stored, mutation.session)
  ) {
    throw new Error('Nursing delete and restore must preserve the exact completed record.');
  }
}

function assertOperationPayload(mutation: NursingMutation): void {
  let expected: Readonly<Record<string, JsonValue>> | null = null;
  if (mutation.operation.action === 'edit_nursing_session') {
    expected = {
      startedAt: mutation.session.startedAt,
      endedAt: mutation.session.endedAt,
      status: mutation.session.status,
      leftDurationSeconds: mutation.session.leftDurationSeconds,
      rightDurationSeconds: mutation.session.rightDurationSeconds,
      totalPauseDurationSeconds: mutation.session.totalPauseDurationSeconds,
      activeSide: mutation.session.activeSide,
      activeSideStartedAt: mutation.session.activeSideStartedAt,
      pauseStartedAt: mutation.session.pauseStartedAt,
      lastBreastUsed: mutation.session.lastBreastUsed,
      deletedAt: mutation.session.deletedAt,
    };
  } else if (
    mutation.operation.action === 'delete_nursing_session' ||
    mutation.operation.action === 'restore_nursing_session'
  ) {
    expected = {};
  }

  if (expected !== null && !jsonRecordsEqual(mutation.operation.payload, expected)) {
    throw new Error('A Nursing operation payload must exactly match its aggregate mutation.');
  }
}

function sameNursingBusinessFields(stored: NursingSession, current: NursingSession): boolean {
  return (
    stored.id === current.id &&
    stored.childId === current.childId &&
    stored.startedAt === current.startedAt &&
    stored.endedAt === current.endedAt &&
    stored.status === current.status &&
    stored.leftDurationSeconds === current.leftDurationSeconds &&
    stored.rightDurationSeconds === current.rightDurationSeconds &&
    stored.totalPauseDurationSeconds === current.totalPauseDurationSeconds &&
    stored.activeSide === current.activeSide &&
    stored.activeSideStartedAt === current.activeSideStartedAt &&
    stored.pauseStartedAt === current.pauseStartedAt &&
    stored.lastBreastUsed === current.lastBreastUsed &&
    stored.timezone === current.timezone &&
    stored.createdBy === current.createdBy
  );
}

function jsonRecordsEqual(
  actual: Readonly<Record<string, JsonValue>>,
  expected: Readonly<Record<string, JsonValue>>,
): boolean {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index] && actual[key] === expected[key])
  );
}

async function assertNoOtherOpenNursing(
  transaction: SQLiteDatabase,
  session: NursingSession,
): Promise<void> {
  if (session.deletedAt !== null || session.status === 'completed') return;
  const row = await transaction.getFirstAsync<{ id: string }>(
    `SELECT id FROM nursing_sessions
     WHERE child_id = ?
       AND id <> ?
       AND status IN ('active', 'paused')
       AND deleted_at IS NULL
     LIMIT 1`,
    session.childId,
    session.id,
  );
  if (row !== null) throw new ActiveNursingSessionError();
}

async function upsertSession(
  transaction: SQLiteDatabase,
  session: NursingSession,
  expectedVersion: number | null,
): Promise<SQLiteRunResult> {
  return transaction.runAsync(
    `INSERT INTO nursing_sessions (
      id, child_id, started_at, ended_at, status,
      left_duration_seconds, right_duration_seconds, total_pause_duration_seconds,
      active_side, active_side_started_at, pause_started_at, last_breast_used,
      timezone, created_by, updated_by, version, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      status = excluded.status,
      left_duration_seconds = excluded.left_duration_seconds,
      right_duration_seconds = excluded.right_duration_seconds,
      total_pause_duration_seconds = excluded.total_pause_duration_seconds,
      active_side = excluded.active_side,
      active_side_started_at = excluded.active_side_started_at,
      pause_started_at = excluded.pause_started_at,
      last_breast_used = excluded.last_breast_used,
      updated_by = excluded.updated_by,
      version = excluded.version,
      deleted_at = excluded.deleted_at
    WHERE nursing_sessions.version = ?`,
    session.id,
    session.childId,
    session.startedAt,
    session.endedAt,
    session.status,
    session.leftDurationSeconds,
    session.rightDurationSeconds,
    session.totalPauseDurationSeconds,
    session.activeSide,
    session.activeSideStartedAt,
    session.pauseStartedAt,
    session.lastBreastUsed,
    session.timezone,
    session.createdBy,
    session.updatedBy,
    session.version,
    session.deletedAt,
    expectedVersion,
  );
}

function mapSession(row: NursingRow): NursingSession {
  const session: NursingSession = {
    id: row.id,
    childId: row.child_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    leftDurationSeconds: row.left_duration_seconds,
    rightDurationSeconds: row.right_duration_seconds,
    totalPauseDurationSeconds: row.total_pause_duration_seconds,
    activeSide: row.active_side,
    activeSideStartedAt: row.active_side_started_at,
    pauseStartedAt: row.pause_started_at,
    lastBreastUsed: row.last_breast_used,
    timezone: row.timezone,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    version: row.version,
    deletedAt: row.deleted_at,
  };
  assertValidNursingSession(session);
  return session;
}
