/// <reference types="node" />

import {
  deleteNap,
  editNap,
  restoreNap,
  startNap,
  stopNap,
  type MutationContext,
} from '@baby-tracker/domain';
import type { SQLiteDatabase } from 'expo-sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { migrateDatabase } from '../../storage/migrations';
import {
  NapOverlapError,
  NapWriteConflictError,
  SQLiteNapRepository,
} from './sqlite-nap-repository';

describe('SQLite nap repository', () => {
  let database: DatabaseSync;
  let adapter: NodeSQLiteAdapter;
  let repository: SQLiteNapRepository;
  let temporaryDirectory: string;
  let databasePath: string;

  beforeEach(async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'baby-tracker-sqlite-'));
    databasePath = join(temporaryDirectory, 'baby-tracker.db');
    database = new DatabaseSync(databasePath);
    adapter = new NodeSQLiteAdapter(database);
    await migrateDatabase(adapter.asExpoDatabase());
    repository = new SQLiteNapRepository(adapter.asExpoDatabase());
  });

  afterEach(() => {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('persists edits, delete, and stable-ID restore through the transactional outbox', async () => {
    const started = startNap(context('2026-08-12T23:55:00.000Z'));
    await repository.save(started);

    const edited = editNap(
      started.session,
      new Date('2026-08-12T23:50:00.000Z'),
      null,
      context('2026-08-12T23:56:00.000Z'),
    );
    await repository.save(edited);

    const completed = stopNap(
      edited.session,
      context('2026-08-13T00:25:00.000Z'),
      new Date('2026-08-13T00:20:00.000Z'),
    );
    await repository.save(completed);

    const firstDay = await repository.listVisible(
      'child-arthur',
      '2026-08-12T00:00:00.000Z',
      '2026-08-13T00:00:00.000Z',
    );
    const secondDay = await repository.listVisible(
      'child-arthur',
      '2026-08-13T00:00:00.000Z',
      '2026-08-14T00:00:00.000Z',
    );
    expect(firstDay[0]).toMatchObject({
      id: started.session.id,
      startedAt: '2026-08-12T23:50:00.000Z',
      endedAt: '2026-08-13T00:20:00.000Z',
      phase: { startedAt: '2026-08-12T23:50:00.000Z' },
    });
    expect(secondDay[0]?.id).toBe(started.session.id);

    const deleted = deleteNap(completed.session, context('2026-08-13T00:26:00.000Z'));
    await repository.save(deleted);
    expect(
      await repository.listVisible(
        'child-arthur',
        '2026-08-12T00:00:00.000Z',
        '2026-08-14T00:00:00.000Z',
      ),
    ).toEqual([]);

    const restored = restoreNap(deleted.session, context('2026-08-13T00:27:00.000Z'));
    await repository.save(restored);
    database.close();
    database = new DatabaseSync(databasePath);
    adapter = new NodeSQLiteAdapter(database);
    await migrateDatabase(adapter.asExpoDatabase());
    const afterRestart = new SQLiteNapRepository(adapter.asExpoDatabase());
    const visible = await afterRestart.listVisible(
      'child-arthur',
      '2026-08-12T00:00:00.000Z',
      '2026-08-14T00:00:00.000Z',
    );
    expect(visible[0]).toMatchObject({
      id: started.session.id,
      version: 5,
      deletedAt: null,
      phase: { id: started.session.phase.id, version: 5, deletedAt: null },
    });
    expect(await afterRestart.pendingOperationCount()).toBe(5);
  });

  it('uses half-open day boundaries at exact midnight', async () => {
    const started = startNap(context('2026-08-12T23:50:00.000Z'));
    await repository.save(started);
    const completed = stopNap(started.session, context('2026-08-13T00:00:00.000Z'));
    await repository.save(completed);

    expect(
      await repository.listVisible(
        'child-arthur',
        '2026-08-12T00:00:00.000Z',
        '2026-08-13T00:00:00.000Z',
      ),
    ).toHaveLength(1);
    expect(
      await repository.listVisible(
        'child-arthur',
        '2026-08-13T00:00:00.000Z',
        '2026-08-14T00:00:00.000Z',
      ),
    ).toHaveLength(0);
  });

  it('rejects a corrected nap that overlaps existing history', async () => {
    const first = startNap(context('2026-08-12T10:00:00.000Z'));
    await repository.save(first);
    await repository.save(stopNap(first.session, context('2026-08-12T10:30:00.000Z')));

    const overlapping = startNap(
      context('2026-08-12T11:00:00.000Z'),
      new Date('2026-08-12T10:15:00.000Z'),
    );
    await expect(repository.save(overlapping)).rejects.toBeInstanceOf(NapOverlapError);
    expect(await repository.pendingOperationCount()).toBe(2);
  });

  it('rolls back entity writes when optimistic versions or outbox writes fail', async () => {
    const started = startNap(context('2026-08-12T12:00:00.000Z'));
    await repository.save(started);
    const completed = stopNap(started.session, context('2026-08-12T12:30:00.000Z'));
    await repository.save(completed);

    const firstEdit = editNap(
      completed.session,
      new Date('2026-08-12T11:58:00.000Z'),
      new Date('2026-08-12T12:32:00.000Z'),
      context('2026-08-12T12:35:00.000Z'),
    );
    await repository.save(firstEdit);

    const staleEdit = editNap(
      completed.session,
      new Date('2026-08-12T11:55:00.000Z'),
      new Date('2026-08-12T12:35:00.000Z'),
      context('2026-08-12T12:36:00.000Z'),
    );
    await expect(repository.save(staleEdit)).rejects.toBeInstanceOf(NapWriteConflictError);

    const duplicateOutboxEdit = editNap(
      firstEdit.session,
      new Date('2026-08-12T11:56:00.000Z'),
      new Date('2026-08-12T12:34:00.000Z'),
      context('2026-08-12T12:37:00.000Z'),
    );
    duplicateOutboxEdit.operation.operationId = firstEdit.operation.operationId;
    await expect(repository.save(duplicateOutboxEdit)).rejects.toThrow();

    const visible = await repository.listVisible(
      'child-arthur',
      '2026-08-12T00:00:00.000Z',
      '2026-08-13T00:00:00.000Z',
    );
    expect(visible[0]).toMatchObject({
      version: 3,
      startedAt: '2026-08-12T11:58:00.000Z',
      endedAt: '2026-08-12T12:32:00.000Z',
      phase: { version: 3, startedAt: '2026-08-12T11:58:00.000Z' },
    });
    expect(await repository.pendingOperationCount()).toBe(3);
  });
});

function context(at: string): MutationContext {
  let sequence = 0;
  return {
    caregiverId: 'caregiver-paloma',
    childId: 'child-arthur',
    now: new Date(at),
    timezone: 'Europe/Lisbon',
    newId: () => `${at}-id-${sequence++}`,
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
