import type { NapMutation, NapSession } from '@baby-tracker/domain';
import type { SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';

interface SessionRow {
  id: string;
  child_id: string;
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

const SELECT_NAPS = `
  SELECT
    session.id,
    session.child_id,
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
  INNER JOIN sleep_phases AS phase
    ON phase.sleep_session_id = session.id AND phase.kind = 'asleep'
  WHERE session.kind = 'nap'
`;

export class SQLiteNapRepository {
  public constructor(private readonly database: SQLiteDatabase) {}

  public async listVisible(
    childId: string,
    dayStartedAt: string,
    nextDayStartedAt: string,
  ): Promise<NapSession[]> {
    const rows = await this.database.getAllAsync<SessionRow>(
      `${SELECT_NAPS}
        AND session.child_id = ?
        AND session.deleted_at IS NULL
        AND session.started_at < ?
        AND (session.ended_at IS NULL OR session.ended_at > ?)
        ORDER BY session.started_at DESC`,
      childId,
      nextDayStartedAt,
      dayStartedAt,
    );

    return rows.map(mapSession);
  }

  public async latestCompletedEnd(childId: string): Promise<string | null> {
    const row = await this.database.getFirstAsync<{ ended_at: string | null }>(
      `SELECT MAX(ended_at) AS ended_at
       FROM sleep_sessions
       WHERE child_id = ?
         AND kind = 'nap'
         AND status = 'completed'
         AND deleted_at IS NULL`,
      childId,
    );
    return row?.ended_at ?? null;
  }

  public async active(childId: string): Promise<NapSession | null> {
    const row = await this.database.getFirstAsync<SessionRow>(
      `${SELECT_NAPS}
       AND session.child_id = ?
       AND session.status = 'active'
       AND session.deleted_at IS NULL
       LIMIT 1`,
      childId,
    );
    return row === null ? null : mapSession(row);
  }

  public async save(mutation: NapMutation): Promise<void> {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await assertNoOverlap(transaction, mutation.session);
      const sessionResult = await upsertSession(
        transaction,
        mutation.session,
        mutation.operation.baseVersion,
      );
      if (sessionResult.changes === 0) {
        throw new NapWriteConflictError();
      }
      const phaseResult = await upsertPhase(
        transaction,
        mutation.session,
        mutation.operation.baseVersion,
      );
      if (phaseResult.changes === 0) {
        throw new NapWriteConflictError();
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

export class NapWriteConflictError extends Error {
  public constructor() {
    super('This nap changed before your update was saved. Refresh and try again.');
    this.name = 'NapWriteConflictError';
  }
}

export class NapOverlapError extends Error {
  public constructor() {
    super('This nap overlaps another nap. Adjust its start or end time.');
    this.name = 'NapOverlapError';
  }
}

/**
 * Ensures that the session does not overlap another non-deleted nap for the same child.
 *
 * @param session - The nap session to check.
 * @throws `NapOverlapError` if the session overlaps another non-deleted nap.
 */
async function assertNoOverlap(transaction: SQLiteDatabase, session: NapSession): Promise<void> {
  if (session.deletedAt !== null) return;

  const row = await transaction.getFirstAsync<{ id: string }>(
    `SELECT id
     FROM sleep_sessions
     WHERE child_id = ?
       AND kind = 'nap'
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
  if (row !== null) throw new NapOverlapError();
}

/**
 * Persists a nap session while applying an optimistic version check to existing records.
 *
 * @param session - The nap session to insert or update
 * @param expectedVersion - The version required for an existing session update
 * @returns The result of the database write
 */
async function upsertSession(
  transaction: SQLiteDatabase,
  session: NapSession,
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

/**
 * Upserts the phase associated with a nap session using an optimistic version check.
 *
 * @param session - The nap session containing the phase to persist
 * @param expectedVersion - The existing phase version required for an update
 * @returns The result of the database write
 */
async function upsertPhase(
  transaction: SQLiteDatabase,
  session: NapSession,
  expectedVersion: number | null,
): Promise<SQLiteRunResult> {
  return transaction.runAsync(
    `INSERT INTO sleep_phases (
      id, sleep_session_id, kind, started_at, ended_at,
      created_by, updated_by, version, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      updated_by = excluded.updated_by,
      version = excluded.version,
      deleted_at = excluded.deleted_at
    WHERE sleep_phases.version = ?`,
    session.phase.id,
    session.id,
    session.phase.kind,
    session.phase.startedAt,
    session.phase.endedAt,
    session.phase.createdBy,
    session.phase.updatedBy,
    session.phase.version,
    session.phase.deletedAt,
    expectedVersion,
  );
}

function mapSession(row: SessionRow): NapSession {
  return {
    id: row.id,
    childId: row.child_id,
    kind: 'nap',
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    timezone: row.timezone,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    version: row.version,
    deletedAt: row.deleted_at,
    phase: {
      id: row.phase_id,
      sleepSessionId: row.id,
      kind: row.phase_kind,
      startedAt: row.phase_started_at,
      endedAt: row.phase_ended_at,
      createdBy: row.phase_created_by,
      updatedBy: row.phase_updated_by,
      version: row.phase_version,
      deletedAt: row.phase_deleted_at,
    },
  };
}
