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
        AND (session.ended_at IS NULL OR session.ended_at >= ?)
        ORDER BY session.started_at DESC`,
      childId,
      nextDayStartedAt,
      dayStartedAt,
    );

    return rows.map(mapSession);
  }

  public async save(mutation: NapMutation): Promise<void> {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const sessionResult = await upsertSession(
        transaction,
        mutation.session,
        mutation.operation.baseVersion,
      );
      if (sessionResult.changes === 0) {
        throw new NapWriteConflictError();
      }
      await upsertPhase(transaction, mutation.session);
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
  session: NapSession,
): Promise<SQLiteRunResult> {
  return transaction.runAsync(
    `INSERT INTO sleep_phases (
      id, sleep_session_id, kind, started_at, ended_at,
      created_by, updated_by, version, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      ended_at = excluded.ended_at,
      updated_by = excluded.updated_by,
      version = excluded.version,
      deleted_at = excluded.deleted_at`,
    session.phase.id,
    session.id,
    session.phase.kind,
    session.phase.startedAt,
    session.phase.endedAt,
    session.phase.createdBy,
    session.phase.updatedBy,
    session.phase.version,
    session.phase.deletedAt,
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
