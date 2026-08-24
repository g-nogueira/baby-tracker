import {
  assertValidCareEvent,
  type CareEvent,
  type CareEventKind,
  type CareEventMutation,
} from '@baby-tracker/domain';
import type { SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';

interface CareEventRow {
  id: string;
  child_id: string;
  kind: CareEventKind;
  occurred_at: string;
  timezone: string;
  data_json: string;
  created_by: string;
  updated_by: string;
  version: number;
  deleted_at: string | null;
}

interface StoredCareEventRoot {
  id: string;
  child_id: string;
  kind: CareEventKind;
  occurred_at: string;
  timezone: string;
  data_json: string;
  created_by: string;
  version: number;
  deleted_at: string | null;
}

const SELECT_CARE_EVENT = `
  SELECT
    id, child_id, kind, occurred_at, timezone, data_json,
    created_by, updated_by, version, deleted_at
  FROM care_events
`;

export class SQLiteCareEventRepository {
  public constructor(private readonly database: SQLiteDatabase) {}

  public async findById(eventId: string): Promise<CareEvent | null> {
    const row = await this.database.getFirstAsync<CareEventRow>(
      `${SELECT_CARE_EVENT} WHERE id = ?`,
      eventId,
    );
    return row === null ? null : mapCareEvent(row);
  }

  public async listVisible(
    childId: string,
    rangeStartedAt: string,
    rangeEndedAt: string,
    kind?: CareEventKind,
  ): Promise<CareEvent[]> {
    assertHalfOpenRange(rangeStartedAt, rangeEndedAt);
    const kindClause = kind === undefined ? '' : 'AND kind = ?';
    const parameters =
      kind === undefined
        ? [childId, rangeStartedAt, rangeEndedAt]
        : [childId, rangeStartedAt, rangeEndedAt, kind];
    const rows = await this.database.getAllAsync<CareEventRow>(
      `${SELECT_CARE_EVENT}
       WHERE child_id = ?
         AND occurred_at >= ?
         AND occurred_at < ?
         AND deleted_at IS NULL
         ${kindClause}
       ORDER BY occurred_at DESC, id DESC`,
      ...parameters,
    );
    return rows.map(mapCareEvent);
  }

  public async save(mutation: CareEventMutation): Promise<void> {
    assertValidCareEvent(mutation.event);
    assertOperationSemantics(mutation);

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const stored = await assertStoredRootSemantics(transaction, mutation);
      assertStoredActionTransition(stored, mutation);
      const result = await upsertCareEvent(
        transaction,
        mutation.event,
        mutation.operation.baseVersion,
      );
      if (result.changes === 0) throw new CareEventWriteConflictError();

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

export class CareEventWriteConflictError extends Error {
  public constructor() {
    super('This care event changed before your update was saved. Refresh and try again.');
    this.name = 'CareEventWriteConflictError';
  }
}

export class InvalidStoredCareEventError extends Error {
  public constructor() {
    super('Stored care-event data is invalid and cannot be displayed.');
    this.name = 'InvalidStoredCareEventError';
  }
}

function assertOperationSemantics(mutation: CareEventMutation): void {
  const { event, operation } = mutation;
  const expectedBaseVersion = event.version === 1 ? null : event.version - 1;
  if (
    operation.operationId.length === 0 ||
    operation.entityId !== event.id ||
    operation.entityType !== 'care_event' ||
    operation.baseVersion !== expectedBaseVersion ||
    !isCanonicalInstant(operation.clientOccurredAt) ||
    !isValidTimezone(operation.clientTimezone)
  ) {
    throw new Error('A care-event mutation must target its root and advance one valid version.');
  }

  const creating = operation.baseVersion === null;
  if (
    (creating && operation.action !== 'create_care_event') ||
    (!creating && operation.action === 'create_care_event')
  ) {
    throw new Error('Only a new care event can use the create action.');
  }
  if (creating && event.deletedAt !== null) {
    throw new Error('A new care event must be visible.');
  }

  if (operation.action === 'create_care_event' || operation.action === 'edit_care_event') {
    if (
      Object.keys(operation.payload).length !== 3 ||
      operation.payload.kind !== event.kind ||
      operation.payload.occurredAt !== event.occurredAt ||
      !sameData(operation.payload.data, event)
    ) {
      throw new Error('A care-event write payload must match the canonical event.');
    }
  } else {
    if (Object.keys(operation.payload).length !== 0) {
      throw new Error('A care-event tombstone operation cannot contain event data.');
    }
    if (
      operation.action === 'delete_care_event' &&
      event.deletedAt !== operation.clientOccurredAt
    ) {
      throw new Error('A care-event delete timestamp must match its operation timestamp.');
    }
  }
}

async function assertStoredRootSemantics(
  transaction: SQLiteDatabase,
  mutation: CareEventMutation,
): Promise<StoredCareEventRoot | null> {
  const stored = await transaction.getFirstAsync<StoredCareEventRoot>(
    `SELECT id, child_id, kind, occurred_at, timezone, data_json,
            created_by, version, deleted_at
     FROM care_events
     WHERE id = ?`,
    mutation.event.id,
  );
  const baseVersion = mutation.operation.baseVersion;
  if (baseVersion === null) {
    if (stored !== null) throw new CareEventWriteConflictError();
    return null;
  }
  if (stored === null || stored.version !== baseVersion) {
    throw new CareEventWriteConflictError();
  }
  if (
    stored.child_id !== mutation.event.childId ||
    stored.kind !== mutation.event.kind ||
    stored.timezone !== mutation.event.timezone ||
    stored.created_by !== mutation.event.createdBy
  ) {
    throw new Error('A care-event update cannot change immutable ownership or kind fields.');
  }
  if (
    (mutation.operation.action === 'delete_care_event' ||
      mutation.operation.action === 'restore_care_event') &&
    (stored.occurred_at !== mutation.event.occurredAt ||
      !storedDataMatchesEvent(stored.data_json, mutation.event))
  ) {
    throw new Error('A care-event tombstone cannot change its occurrence time or event data.');
  }
  return stored;
}

function assertStoredActionTransition(
  stored: StoredCareEventRoot | null,
  mutation: CareEventMutation,
): void {
  const wasVisible = stored?.deleted_at === null;
  const isVisible = mutation.event.deletedAt === null;
  const valid = (() => {
    switch (mutation.operation.action) {
      case 'create_care_event':
        return stored === null && isVisible;
      case 'edit_care_event':
        return stored !== null && wasVisible && isVisible;
      case 'delete_care_event':
        return stored !== null && wasVisible && !isVisible;
      case 'restore_care_event':
        return stored !== null && !wasVisible && isVisible;
    }
  })();
  if (!valid) throw new Error('The care-event action does not match its stored lifecycle.');
}

async function upsertCareEvent(
  transaction: SQLiteDatabase,
  event: CareEvent,
  expectedVersion: number | null,
): Promise<SQLiteRunResult> {
  return transaction.runAsync(
    `INSERT INTO care_events (
      id, child_id, kind, occurred_at, timezone, data_json,
      created_by, updated_by, version, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      occurred_at = excluded.occurred_at,
      data_json = excluded.data_json,
      updated_by = excluded.updated_by,
      version = excluded.version,
      deleted_at = excluded.deleted_at
    WHERE care_events.version = ?`,
    event.id,
    event.childId,
    event.kind,
    event.occurredAt,
    event.timezone,
    JSON.stringify(event.data),
    event.createdBy,
    event.updatedBy,
    event.version,
    event.deletedAt,
    expectedVersion,
  );
}

function mapCareEvent(row: CareEventRow): CareEvent {
  try {
    const event = {
      id: row.id,
      childId: row.child_id,
      kind: row.kind,
      occurredAt: row.occurred_at,
      data: JSON.parse(row.data_json) as unknown,
      timezone: row.timezone,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      version: row.version,
      deletedAt: row.deleted_at,
    };
    assertValidCareEvent(event);
    return event;
  } catch {
    throw new InvalidStoredCareEventError();
  }
}

function sameData(data: unknown, event: CareEvent): boolean {
  if (!isRecord(data)) return false;
  if (event.kind === 'diaper') {
    return Object.keys(data).length === 1 && data.diaperType === event.data.diaperType;
  }
  return Object.keys(data).length === 1 && data.note === event.data.note;
}

function storedDataMatchesEvent(dataJson: string, event: CareEvent): boolean {
  try {
    return sameData(JSON.parse(dataJson) as unknown, event);
  } catch {
    throw new InvalidStoredCareEventError();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertHalfOpenRange(startedAt: string, endedAt: string): void {
  if (
    !isCanonicalInstant(startedAt) ||
    !isCanonicalInstant(endedAt) ||
    new Date(startedAt).getTime() >= new Date(endedAt).getTime()
  ) {
    throw new Error('A care-event query requires a valid increasing half-open UTC range.');
  }
}

function isCanonicalInstant(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}
