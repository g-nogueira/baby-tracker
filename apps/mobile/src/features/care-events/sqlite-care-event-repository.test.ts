/// <reference types="node" />

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import {
  type CareEventMutation,
  createDiaperEvent,
  createMedicineEvent,
  deleteCareEvent,
  editCareEvent,
  type MutationContext,
  restoreCareEvent,
  startNap,
  startNursing,
} from '@baby-tracker/domain';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { migrateDatabase } from '../../storage/migrations';
import { SQLiteNursingRepository } from '../nursing/sqlite-nursing-repository';
import { SQLiteSleepRepository } from '../sleep/sqlite-sleep-repository';
import {
  CareEventWriteConflictError,
  InvalidStoredCareEventError,
  SQLiteCareEventRepository,
} from './sqlite-care-event-repository';

describe('SQLite CareEvent repository', () => {
  let database: DatabaseSync;
  let adapter: NodeSQLiteAdapter;
  let repository: SQLiteCareEventRepository;
  let temporaryDirectory: string;
  let databasePath: string;

  beforeEach(async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'baby-tracker-care-event-sqlite-'));
    databasePath = join(temporaryDirectory, 'baby-tracker.db');
    database = new DatabaseSync(databasePath);
    adapter = new NodeSQLiteAdapter(database);
    await migrateDatabase(adapter.asExpoDatabase());
    repository = new SQLiteCareEventRepository(adapter.asExpoDatabase());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('atomically persists create, edit, delete, restore, and exact outbox metadata', async () => {
    const created = createMedicineEvent(
      '  original private note  ',
      context('2026-08-15T12:00:00.500Z'),
      new Date('2026-08-15T11:59:00.125Z'),
    );
    await repository.save(created);
    const edited = editCareEvent(
      created.event,
      {
        occurredAt: new Date('2026-08-15T11:58:30.250Z'),
        data: { note: 'changed private note' },
      },
      context('2026-08-15T12:01:00.000Z'),
    );
    await repository.save(edited);
    const deleted = deleteCareEvent(edited.event, context('2026-08-15T12:02:00.000Z'));
    await repository.save(deleted);
    const restored = restoreCareEvent(deleted.event, context('2026-08-15T12:03:00.000Z'));
    await repository.save(restored);

    expect(await repository.findById(created.event.id)).toEqual(restored.event);
    expect(database.prepare('SELECT * FROM care_events').all()).toEqual([
      {
        id: created.event.id,
        child_id: 'child-arthur',
        kind: 'medicine',
        occurred_at: '2026-08-15T11:58:30.250Z',
        timezone: 'Europe/Lisbon',
        data_json: '{"note":"changed private note"}',
        created_by: 'caregiver-paloma',
        updated_by: 'caregiver-paloma',
        version: 4,
        deleted_at: null,
      },
    ]);
    const operations = database
      .prepare(
        `SELECT operation_id, entity_id, entity_type, action, base_version,
                client_occurred_at, client_timezone, payload_json
         FROM outbox_operations ORDER BY local_sequence`,
      )
      .all() as Array<{
      operation_id: string;
      entity_id: string;
      entity_type: string;
      action: string;
      base_version: number | null;
      client_occurred_at: string;
      client_timezone: string;
      payload_json: string;
    }>;
    expect(operations.map(({ operation_id }) => operation_id)).toEqual([
      '2026-08-15T12:00:00.500Z-id-1',
      '2026-08-15T12:01:00.000Z-id-0',
      '2026-08-15T12:02:00.000Z-id-0',
      '2026-08-15T12:03:00.000Z-id-0',
    ]);
    expect(operations.map(({ entity_id }) => entity_id)).toEqual(
      Array.from({ length: 4 }, () => created.event.id),
    );
    expect(operations.every(({ entity_type }) => entity_type === 'care_event')).toBe(true);
    expect(operations.map(({ action }) => action)).toEqual([
      'create_care_event',
      'edit_care_event',
      'delete_care_event',
      'restore_care_event',
    ]);
    expect(operations.map(({ base_version }) => base_version)).toEqual([null, 1, 2, 3]);
    expect(operations.map(({ client_occurred_at }) => client_occurred_at)).toEqual([
      '2026-08-15T12:00:00.500Z',
      '2026-08-15T12:01:00.000Z',
      '2026-08-15T12:02:00.000Z',
      '2026-08-15T12:03:00.000Z',
    ]);
    expect(operations.every(({ client_timezone }) => client_timezone === 'Europe/Lisbon')).toBe(
      true,
    );
    expect(operations.map(({ payload_json }) => JSON.parse(payload_json))).toEqual([
      {
        kind: 'medicine',
        occurredAt: '2026-08-15T11:59:00.125Z',
        data: { note: '  original private note  ' },
      },
      {
        kind: 'medicine',
        occurredAt: '2026-08-15T11:58:30.250Z',
        data: { note: 'changed private note' },
      },
      {},
      {},
    ]);
  });

  it('lists visible point events in an exact half-open range with deterministic ties', async () => {
    const atStart = createDiaperEvent(
      'dry',
      contextWithIds('2026-08-16T00:00:01.000Z', ['at-start', 'op-start']),
      new Date('2026-08-15T00:00:00.000Z'),
    );
    const tieA = createMedicineEvent(
      'A',
      contextWithIds('2026-08-16T00:00:01.000Z', ['tie-a', 'op-a']),
      new Date('2026-08-15T12:00:00.000Z'),
    );
    const tieB = createDiaperEvent(
      'wet',
      contextWithIds('2026-08-16T00:00:01.000Z', ['tie-b', 'op-b']),
      new Date('2026-08-15T12:00:00.000Z'),
    );
    const atEnd = createDiaperEvent(
      'dirty',
      contextWithIds('2026-08-16T00:00:01.000Z', ['at-end', 'op-end']),
      new Date('2026-08-16T00:00:00.000Z'),
    );
    const deleted = createDiaperEvent(
      'mixed',
      contextWithIds('2026-08-16T00:00:01.000Z', ['deleted', 'op-deleted']),
      new Date('2026-08-15T13:00:00.000Z'),
    );
    for (const mutation of [atStart, tieA, tieB, atEnd, deleted]) {
      await repository.save(mutation);
    }
    await repository.save(
      deleteCareEvent(deleted.event, contextWithIds('2026-08-16T00:00:02.000Z', ['op-delete'])),
    );

    const visible = await repository.listVisible(
      'child-arthur',
      '2026-08-15T00:00:00.000Z',
      '2026-08-16T00:00:00.000Z',
    );
    expect(visible.map(({ id }) => id)).toEqual(['tie-b', 'tie-a', 'at-start']);
    expect(
      (
        await repository.listVisible(
          'child-arthur',
          '2026-08-15T00:00:00.000Z',
          '2026-08-16T00:00:00.000Z',
          'diaper',
        )
      ).map(({ id }) => id),
    ).toEqual(['tie-b', 'at-start']);
    await expect(
      repository.listVisible(
        'child-arthur',
        '2026-08-16T00:00:00.000Z',
        '2026-08-16T00:00:00.000Z',
      ),
    ).rejects.toThrow('A care-event query requires a valid increasing half-open UTC range.');
  });

  it('preserves both exact event kinds through restart and an idempotent v4 migration', async () => {
    const diaper = createDiaperEvent(
      'dirty',
      contextWithIds('2026-08-15T12:00:00.000Z', ['restart-diaper', 'diaper-create']),
    );
    await repository.save(diaper);
    const editedDiaper = editCareEvent(
      diaper.event,
      { occurredAt: new Date(diaper.event.occurredAt), data: { diaperType: 'mixed' } },
      contextWithIds('2026-08-15T12:01:00.000Z', ['diaper-edit']),
    );
    await repository.save(editedDiaper);

    const medicine = createMedicineEvent(
      '  exact private note\nkept verbatim  ',
      contextWithIds('2026-08-15T12:02:00.000Z', ['restart-medicine', 'medicine-create']),
    );
    await repository.save(medicine);
    const deletedMedicine = deleteCareEvent(
      medicine.event,
      contextWithIds('2026-08-15T12:03:00.000Z', ['medicine-delete']),
    );
    await repository.save(deletedMedicine);

    const beforeRows = database.prepare('SELECT * FROM care_events ORDER BY id').all();
    const beforeOutbox = database
      .prepare('SELECT * FROM outbox_operations ORDER BY local_sequence')
      .all();

    restartDatabase();
    await migrateDatabase(adapter.asExpoDatabase());
    repository = new SQLiteCareEventRepository(adapter.asExpoDatabase());

    expect(await repository.findById(editedDiaper.event.id)).toEqual(editedDiaper.event);
    expect(await repository.findById(deletedMedicine.event.id)).toEqual(deletedMedicine.event);
    expect(deletedMedicine.event).toMatchObject({
      id: medicine.event.id,
      version: 2,
      deletedAt: '2026-08-15T12:03:00.000Z',
      data: { note: '  exact private note\nkept verbatim  ' },
    });
    expect(database.prepare('SELECT * FROM care_events ORDER BY id').all()).toEqual(beforeRows);
    expect(
      database.prepare('SELECT * FROM outbox_operations ORDER BY local_sequence').all(),
    ).toEqual(beforeOutbox);

    database
      .prepare('UPDATE care_events SET data_json = ? WHERE id = ?')
      .run('{"diaperType":"mixed","unsupported":"private"}', editedDiaper.event.id);
    await expect(repository.findById(editedDiaper.event.id)).rejects.toBeInstanceOf(
      InvalidStoredCareEventError,
    );
    await expect(repository.findById(editedDiaper.event.id)).rejects.toThrow(
      'Stored care-event data is invalid and cannot be displayed.',
    );
  });

  it('rejects missing roots, duplicate creates, stale versions, and duplicate operations atomically', async () => {
    const absentCreate = createDiaperEvent('wet', context('2026-08-15T09:00:00.000Z'));
    const absentUpdate = editCareEvent(
      absentCreate.event,
      { occurredAt: new Date(absentCreate.event.occurredAt), data: { diaperType: 'dirty' } },
      context('2026-08-15T09:01:00.000Z'),
    );
    await expect(repository.save(absentUpdate)).rejects.toBeInstanceOf(CareEventWriteConflictError);
    expect(await repository.pendingOperationCount()).toBe(0);

    const created = createDiaperEvent('wet', context('2026-08-15T10:00:00.000Z'));
    await repository.save(created);
    await expect(repository.save(created)).rejects.toBeInstanceOf(CareEventWriteConflictError);

    const firstEdit = editCareEvent(
      created.event,
      { occurredAt: new Date(created.event.occurredAt), data: { diaperType: 'mixed' } },
      context('2026-08-15T10:01:00.000Z'),
    );
    await repository.save(firstEdit);
    const staleEdit = editCareEvent(
      created.event,
      { occurredAt: new Date(created.event.occurredAt), data: { diaperType: 'dry' } },
      context('2026-08-15T10:02:00.000Z'),
    );
    await expect(repository.save(staleEdit)).rejects.toBeInstanceOf(CareEventWriteConflictError);

    const duplicateOperation = createMedicineEvent('private', context('2026-08-15T10:03:00.000Z'));
    duplicateOperation.operation.operationId = firstEdit.operation.operationId;
    await expect(repository.save(duplicateOperation)).rejects.toThrow();
    expect(await repository.findById(duplicateOperation.event.id)).toBeNull();
    expect(await repository.findById(created.event.id)).toEqual(firstEdit.event);
    expect(await repository.pendingOperationCount()).toBe(2);
  });

  it('rejects immutable root changes, mismatched payloads, and invalid lifecycle actions', async () => {
    const created = createDiaperEvent('wet', context('2026-08-15T10:00:00.000Z'));
    await repository.save(created);

    for (const immutablePatch of [
      { childId: 'different-child' },
      { timezone: 'UTC' },
      { createdBy: 'different-caregiver' },
    ]) {
      const changed = editCareEvent(
        created.event,
        { occurredAt: new Date(created.event.occurredAt), data: { diaperType: 'dirty' } },
        context('2026-08-15T10:01:00.000Z'),
      );
      Object.assign(changed.event, immutablePatch);
      await expect(repository.save(changed)).rejects.toThrow(
        'A care-event update cannot change immutable ownership or kind fields.',
      );
    }

    const kindChange = editCareEvent(
      created.event,
      { occurredAt: new Date(created.event.occurredAt), data: { diaperType: 'dirty' } },
      context('2026-08-15T10:01:00.000Z'),
    ) as unknown as CareEventMutation;
    Object.assign(kindChange.event, { kind: 'medicine', data: { note: 'private' } });
    if (
      kindChange.operation.action === 'create_care_event' ||
      kindChange.operation.action === 'edit_care_event'
    ) {
      Object.assign(kindChange.operation.payload, { kind: 'medicine', data: { note: 'private' } });
    }
    await expect(repository.save(kindChange)).rejects.toThrow(
      'A care-event update cannot change immutable ownership or kind fields.',
    );

    const mismatchedPayload = editCareEvent(
      created.event,
      { occurredAt: new Date(created.event.occurredAt), data: { diaperType: 'dry' } },
      context('2026-08-15T10:02:00.000Z'),
    );
    if (mismatchedPayload.operation.action !== 'edit_care_event') {
      throw new Error('Expected edit operation.');
    }
    Object.assign(mismatchedPayload.operation.payload, { data: { diaperType: 'mixed' } });
    await expect(repository.save(mismatchedPayload)).rejects.toThrow(
      'A care-event write payload must match the canonical event.',
    );

    const deleted = deleteCareEvent(created.event, context('2026-08-15T10:03:00.000Z'));
    const invalidLifecycle = deleted as unknown as CareEventMutation;
    Object.assign(invalidLifecycle.operation, {
      action: 'edit_care_event',
      payload: {
        kind: 'diaper',
        occurredAt: deleted.event.occurredAt,
        data: { diaperType: created.event.data.diaperType },
      },
    });
    await expect(repository.save(invalidLifecycle)).rejects.toThrow(
      'The care-event action does not match its stored lifecycle.',
    );
    expect(await repository.findById(created.event.id)).toEqual(created.event);
    expect(await repository.pendingOperationCount()).toBe(1);
  });

  it('rejects timestamp or typed-data edits smuggled into delete tombstones atomically', async () => {
    const cases: Array<{
      created: CareEventMutation;
      tamper: (mutation: CareEventMutation) => void;
    }> = [
      {
        created: createDiaperEvent(
          'wet',
          contextWithIds('2026-08-15T10:00:00.000Z', ['delete-time', 'create-time']),
        ),
        tamper: (mutation) => {
          mutation.event.occurredAt = '2026-08-15T09:59:00.000Z';
        },
      },
      {
        created: createDiaperEvent(
          'wet',
          contextWithIds('2026-08-15T10:00:01.000Z', ['delete-diaper', 'create-diaper']),
        ),
        tamper: (mutation) => {
          if (mutation.event.kind !== 'diaper') throw new Error('Expected Diaper event.');
          mutation.event.data = { diaperType: 'dirty' };
        },
      },
      {
        created: createMedicineEvent(
          '  original private note  ',
          contextWithIds('2026-08-15T10:00:02.000Z', ['delete-medicine', 'create-medicine']),
        ),
        tamper: (mutation) => {
          if (mutation.event.kind !== 'medicine') throw new Error('Expected Medicine event.');
          mutation.event.data = { note: 'changed private note' };
        },
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      await repository.save(testCase.created);
      const before = await repository.findById(testCase.created.event.id);
      const countBefore = await repository.pendingOperationCount();
      const at = `2026-08-15T10:01:0${index}.000Z`;
      const mutation =
        testCase.created.event.kind === 'diaper'
          ? deleteCareEvent(testCase.created.event, contextWithIds(at, [`delete-op-${index}`]))
          : deleteCareEvent(testCase.created.event, contextWithIds(at, [`delete-op-${index}`]));
      testCase.tamper(mutation);

      await expect(repository.save(mutation)).rejects.toThrow(
        'A care-event tombstone cannot change its occurrence time or event data.',
      );
      expect(await repository.findById(testCase.created.event.id)).toEqual(before);
      expect(await repository.pendingOperationCount()).toBe(countBefore);
    }

    const created = createDiaperEvent(
      'dry',
      contextWithIds('2026-08-15T10:00:10.000Z', ['delete-at', 'create-delete-at']),
    );
    await repository.save(created);
    const before = await repository.findById(created.event.id);
    const countBefore = await repository.pendingOperationCount();
    const mutation = deleteCareEvent(
      created.event,
      contextWithIds('2026-08-15T10:01:10.000Z', ['delete-at-op']),
    );
    mutation.event.deletedAt = '2026-08-15T10:01:11.000Z';

    await expect(repository.save(mutation)).rejects.toThrow(
      'A care-event delete timestamp must match its operation timestamp.',
    );
    expect(await repository.findById(created.event.id)).toEqual(before);
    expect(await repository.pendingOperationCount()).toBe(countBefore);
  });

  it('rejects timestamp or typed-data edits smuggled into restore tombstones atomically', async () => {
    const cases: Array<{
      created: CareEventMutation;
      tamper: (mutation: CareEventMutation) => void;
    }> = [
      {
        created: createDiaperEvent(
          'mixed',
          contextWithIds('2026-08-15T11:00:00.000Z', ['restore-time', 'create-time']),
        ),
        tamper: (mutation) => {
          mutation.event.occurredAt = '2026-08-15T10:59:00.000Z';
        },
      },
      {
        created: createDiaperEvent(
          'dry',
          contextWithIds('2026-08-15T11:00:01.000Z', ['restore-diaper', 'create-diaper']),
        ),
        tamper: (mutation) => {
          if (mutation.event.kind !== 'diaper') throw new Error('Expected Diaper event.');
          mutation.event.data = { diaperType: 'wet' };
        },
      },
      {
        created: createMedicineEvent(
          '  exact private note  ',
          contextWithIds('2026-08-15T11:00:02.000Z', ['restore-medicine', 'create-medicine']),
        ),
        tamper: (mutation) => {
          if (mutation.event.kind !== 'medicine') throw new Error('Expected Medicine event.');
          mutation.event.data = { note: 'changed private note' };
        },
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      await repository.save(testCase.created);
      const deleteAt = `2026-08-15T11:01:0${index}.000Z`;
      const deletion =
        testCase.created.event.kind === 'diaper'
          ? deleteCareEvent(
              testCase.created.event,
              contextWithIds(deleteAt, [`delete-op-${index}`]),
            )
          : deleteCareEvent(
              testCase.created.event,
              contextWithIds(deleteAt, [`delete-op-${index}`]),
            );
      await repository.save(deletion);
      const before = await repository.findById(testCase.created.event.id);
      const countBefore = await repository.pendingOperationCount();
      const restoreAt = `2026-08-15T11:02:0${index}.000Z`;
      const mutation =
        deletion.event.kind === 'diaper'
          ? restoreCareEvent(deletion.event, contextWithIds(restoreAt, [`restore-op-${index}`]))
          : restoreCareEvent(deletion.event, contextWithIds(restoreAt, [`restore-op-${index}`]));
      testCase.tamper(mutation);

      await expect(repository.save(mutation)).rejects.toThrow(
        'A care-event tombstone cannot change its occurrence time or event data.',
      );
      expect(await repository.findById(testCase.created.event.id)).toEqual(before);
      expect(await repository.pendingOperationCount()).toBe(countBefore);
    }
  });

  it('deletes and restores one stable ID while visibility and conflicts remain deterministic', async () => {
    const created = createDiaperEvent('mixed', context('2026-08-15T10:00:00.000Z'));
    await repository.save(created);
    const deleted = deleteCareEvent(created.event, context('2026-08-15T10:01:00.000Z'));
    await repository.save(deleted);
    expect(
      await repository.listVisible(
        'child-arthur',
        '2026-08-15T00:00:00.000Z',
        '2026-08-16T00:00:00.000Z',
      ),
    ).toEqual([]);
    expect(await repository.findById(created.event.id)).toEqual(deleted.event);

    const restored = restoreCareEvent(deleted.event, context('2026-08-15T10:02:00.000Z'));
    await repository.save(restored);
    expect(await repository.findById(created.event.id)).toEqual(restored.event);
    expect(restored.event).toMatchObject({ id: created.event.id, version: 3, deletedAt: null });
    await expect(repository.save(restored)).rejects.toBeInstanceOf(CareEventWriteConflictError);
  });

  it('allows diaper and medicine point events during active Sleep and Nursing', async () => {
    const sleepRepository = new SQLiteSleepRepository(adapter.asExpoDatabase());
    const nursingRepository = new SQLiteNursingRepository(adapter.asExpoDatabase());
    const nap = startNap(
      contextWithIds('2026-08-15T10:00:00.000Z', ['nap', 'nap-phase', 'nap-op']),
    );
    const nursing = startNursing(
      'left',
      contextWithIds('2026-08-15T10:00:00.000Z', ['nursing', 'nursing-op']),
    );
    await sleepRepository.save(nap);
    await nursingRepository.save(nursing);

    const diaper = createDiaperEvent(
      'wet',
      contextWithIds('2026-08-15T10:00:00.000Z', ['diaper', 'diaper-op']),
    );
    const medicine = createMedicineEvent(
      'private',
      contextWithIds('2026-08-15T10:00:00.000Z', ['medicine', 'medicine-op']),
    );
    await repository.save(diaper);
    await repository.save(medicine);

    expect(await sleepRepository.active('child-arthur')).toEqual(nap.session);
    expect(await nursingRepository.active('child-arthur')).toEqual(nursing.session);
    expect(
      await repository.listVisible(
        'child-arthur',
        '2026-08-15T00:00:00.000Z',
        '2026-08-16T00:00:00.000Z',
      ),
    ).toHaveLength(2);
  });

  it('does not log or expose medicine text in repository errors', async () => {
    const secret = 'Secret medicine 123 ml';
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const created = createMedicineEvent(secret, context('2026-08-15T10:00:00.000Z'));
    await repository.save(created);
    const invalid = editCareEvent(
      created.event,
      { occurredAt: new Date(created.event.occurredAt), data: { note: secret } },
      context('2026-08-15T10:01:00.000Z'),
    );
    invalid.operation.entityId = 'wrong-root';

    let message = '';
    try {
      await repository.save(invalid);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain(secret);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  function restartDatabase(): void {
    database.close();
    database = new DatabaseSync(databasePath);
    adapter = new NodeSQLiteAdapter(database);
  }
});

function context(at: string): MutationContext {
  return contextWithIds(at, [`${at}-id-0`, `${at}-id-1`]);
}

function contextWithIds(at: string, ids: string[]): MutationContext {
  let sequence = 0;
  return {
    caregiverId: 'caregiver-paloma',
    childId: 'child-arthur',
    now: new Date(at),
    timezone: 'Europe/Lisbon',
    newId: () => ids[sequence++] ?? `${at}-unexpected-id-${sequence}`,
  };
}

class NodeSQLiteAdapter {
  public constructor(private readonly database: DatabaseSync) {}

  public asExpoDatabase(): SQLiteDatabase {
    return this as unknown as SQLiteDatabase;
  }

  public async execAsync(sql: string): Promise<void> {
    this.database.exec(sql);
  }

  public async getFirstAsync<T>(sql: string, ...params: SQLInputValue[]): Promise<T | null> {
    return (this.database.prepare(sql).get(...params) as T | undefined) ?? null;
  }

  public async getAllAsync<T>(sql: string, ...params: SQLInputValue[]): Promise<T[]> {
    return this.database.prepare(sql).all(...params) as T[];
  }

  public async runAsync(sql: string, ...params: SQLInputValue[]) {
    const result = this.database.prepare(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  }

  public async withExclusiveTransactionAsync<T>(
    task: (transaction: SQLiteDatabase) => Promise<T>,
  ): Promise<T> {
    this.database.exec('BEGIN EXCLUSIVE');
    try {
      const result = await task(this.asExpoDatabase());
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
