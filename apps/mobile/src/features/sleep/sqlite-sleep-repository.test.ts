/// <reference types="node" />

import {
  deleteNightSleep,
  endNightSleep,
  resumeNightSleep,
  restoreNightSleep,
  startNap,
  startNightSleep,
  startNightWaking,
  stopNap,
  type MutationContext,
} from '@baby-tracker/domain';
import type { SQLiteDatabase } from 'expo-sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../../storage/migrations';
import { ActiveSleepSessionError, SQLiteSleepRepository } from './sqlite-sleep-repository';

describe('SQLite sleep repository', () => {
  let database: DatabaseSync;
  let adapter: NodeSQLiteAdapter;
  let repository: SQLiteSleepRepository;
  let temporaryDirectory: string;
  let databasePath: string;

  beforeEach(async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'baby-tracker-sleep-sqlite-'));
    databasePath = join(temporaryDirectory, 'baby-tracker.db');
    database = new DatabaseSync(databasePath);
    adapter = new NodeSQLiteAdapter(database);
    await migrateDatabase(adapter.asExpoDatabase());
    repository = new SQLiteSleepRepository(adapter.asExpoDatabase());
  });

  afterEach(() => {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('persists every Night transition and ordered phases with one outbox row each', async () => {
    const bedtime = startNightSleep(context('2026-08-12T20:30:00.000Z'));
    await repository.save(bedtime);
    const waking = startNightWaking(bedtime.session, context('2026-08-13T00:15:00.000Z'));
    await repository.save(waking);
    const resumed = resumeNightSleep(waking.session, context('2026-08-13T00:35:00.000Z'));
    await repository.save(resumed);
    const ended = endNightSleep(resumed.session, context('2026-08-13T06:10:00.000Z'));
    await repository.save(ended);

    expect(await repository.findById(bedtime.session.id)).toEqual(ended.session);
    expect(await repository.pendingOperationCount()).toBe(4);
    const actions = database
      .prepare('SELECT action FROM outbox_operations ORDER BY local_sequence')
      .all() as Array<{ action: string }>;
    expect(actions.map(({ action }) => action)).toEqual([
      'start_night_sleep',
      'start_night_waking',
      'resume_night_sleep',
      'end_night_sleep',
    ]);
  });

  it('persists completed Night delete and restore with all phase tombstones atomically', async () => {
    const bedtime = startNightSleep(context('2026-08-12T20:30:00.000Z'));
    await repository.save(bedtime);
    const waking = startNightWaking(bedtime.session, context('2026-08-13T00:15:00.000Z'));
    await repository.save(waking);
    const completed = endNightSleep(waking.session, context('2026-08-13T06:00:00.000Z'));
    await repository.save(completed);

    const deleted = deleteNightSleep(completed.session, context('2026-08-13T07:00:00.000Z'));
    await repository.save(deleted);
    expect(await repository.findById(completed.session.id)).toEqual(deleted.session);
    expect(
      await repository.listVisible(
        'child-arthur',
        '2026-08-12T00:00:00.000Z',
        '2026-08-14T00:00:00.000Z',
      ),
    ).toEqual([]);

    const restored = restoreNightSleep(deleted.session, context('2026-08-13T07:05:00.000Z'));
    await repository.save(restored);
    expect(await repository.findById(completed.session.id)).toEqual(restored.session);
    expect(await repository.pendingOperationCount()).toBe(5);
  });

  it('recovers the canonical active Night session and final open phase after restart', async () => {
    const bedtime = startNightSleep(context('2026-08-12T20:30:00.000Z'));
    await repository.save(bedtime);
    const waking = startNightWaking(bedtime.session, context('2026-08-13T00:15:00.000Z'));
    await repository.save(waking);

    restartDatabase();
    const afterRestart = new SQLiteSleepRepository(adapter.asExpoDatabase());
    const active = await afterRestart.active('child-arthur');

    expect(active).toEqual(waking.session);
    expect(active?.phases.map(({ kind }) => kind)).toEqual(['asleep', 'awake']);
    expect(active?.phases.at(-1)).toMatchObject({ kind: 'awake', endedAt: null });
    expect(await afterRestart.pendingOperationCount()).toBe(2);
  });

  it('recovers an active Night session while its asleep phase is open', async () => {
    const bedtime = startNightSleep(context('2026-08-12T20:30:00.000Z'));
    await repository.save(bedtime);

    restartDatabase();
    const afterRestart = new SQLiteSleepRepository(adapter.asExpoDatabase());

    expect(await afterRestart.active('child-arthur')).toEqual(bedtime.session);
    expect((await afterRestart.active('child-arthur'))?.phases.at(-1)).toMatchObject({
      kind: 'asleep',
      endedAt: null,
    });
  });

  it('ends from an awake phase across midnight without adding another phase', async () => {
    const bedtime = startNightSleep(context('2026-08-12T23:30:00.000Z'));
    await repository.save(bedtime);
    const waking = startNightWaking(bedtime.session, context('2026-08-13T00:10:00.000Z'));
    await repository.save(waking);
    const ended = endNightSleep(waking.session, context('2026-08-13T00:25:00.000Z'));
    await repository.save(ended);

    const stored = await repository.findById(bedtime.session.id);
    expect(stored).toMatchObject({
      status: 'completed',
      endedAt: '2026-08-13T00:25:00.000Z',
      phases: [{ kind: 'asleep' }, { kind: 'awake' }],
    });
    expect(stored?.phases).toHaveLength(2);
  });

  it('ends directly from the first asleep phase and persists no artificial phase', async () => {
    const bedtime = startNightSleep(context('2026-08-12T20:30:00.000Z'));
    await repository.save(bedtime);
    const ended = endNightSleep(bedtime.session, context('2026-08-13T06:10:00.000Z'));
    await repository.save(ended);

    expect(await repository.findById(bedtime.session.id)).toEqual(ended.session);
    expect(ended.session.phases).toHaveLength(1);
    expect(await repository.pendingOperationCount()).toBe(2);
  });

  it('rejects starting Nap or Night while any Sleep session is active', async () => {
    const nap = startNap(context('2026-08-12T12:00:00.000Z'));
    await repository.save(nap);

    const night = startNightSleep(context('2026-08-12T20:30:00.000Z'));
    await expect(repository.save(night)).rejects.toBeInstanceOf(ActiveSleepSessionError);
    expect(await repository.pendingOperationCount()).toBe(1);
  });

  it('rejects starting a Nap while a Night session is active', async () => {
    const night = startNightSleep(context('2026-08-12T20:30:00.000Z'));
    await repository.save(night);

    const nap = startNap(context('2026-08-12T21:00:00.000Z'));
    await expect(repository.save(nap)).rejects.toBeInstanceOf(ActiveSleepSessionError);
    expect(await repository.active('child-arthur')).toEqual(night.session);
  });

  it('rolls back phase and session writes when the outbox insert fails', async () => {
    const bedtime = startNightSleep(context('2026-08-12T20:30:00.000Z'));
    await repository.save(bedtime);
    const waking = startNightWaking(bedtime.session, context('2026-08-13T00:15:00.000Z'));
    waking.operation.operationId = bedtime.operation.operationId;

    await expect(repository.save(waking)).rejects.toThrow();
    expect(await repository.active('child-arthur')).toEqual(bedtime.session);
    expect(await repository.pendingOperationCount()).toBe(1);
  });

  it('rejects stale Night session and phase versions without writes or outbox rows', async () => {
    const bedtime = startNightSleep(context('2026-08-12T20:30:00.000Z'));
    await repository.save(bedtime);
    const waking = startNightWaking(bedtime.session, context('2026-08-13T00:15:00.000Z'));
    await repository.save(waking);
    const resumed = resumeNightSleep(waking.session, context('2026-08-13T00:35:00.000Z'));
    await repository.save(resumed);

    const staleSessionMutation = resumeNightSleep(
      waking.session,
      context('2026-08-13T00:40:00.000Z'),
    );
    await expect(repository.save(staleSessionMutation)).rejects.toThrow();

    const validEnd = endNightSleep(resumed.session, context('2026-08-13T06:10:00.000Z'));
    const validClosedPhase = validEnd.changedPhases[0];
    if (validClosedPhase === undefined) throw new Error('Expected a changed phase.');
    const staleOpenPhase = {
      ...validClosedPhase,
      version: validClosedPhase.version - 1,
    };
    const stalePhaseMutation = {
      ...validEnd,
      session: {
        ...validEnd.session,
        phases: validEnd.session.phases.map((phase) =>
          phase.id === staleOpenPhase.id ? staleOpenPhase : phase,
        ),
      },
      changedPhases: [staleOpenPhase],
    };
    await expect(repository.save(stalePhaseMutation)).rejects.toThrow();

    expect(await repository.active('child-arthur')).toEqual(resumed.session);
    expect(await repository.pendingOperationCount()).toBe(3);
  });

  it('rejects divergent changed phases and invalid aggregate-root metadata', async () => {
    const bedtime = startNightSleep(context('2026-08-12T20:30:00.000Z'));
    await repository.save(bedtime);
    const waking = startNightWaking(bedtime.session, context('2026-08-13T00:15:00.000Z'));
    const closedPhase = waking.changedPhases[0];
    const openedPhase = waking.changedPhases[1];
    if (closedPhase === undefined || openedPhase === undefined) {
      throw new Error('Expected closed and opened Night phases.');
    }
    const divergent = {
      ...waking,
      changedPhases: [{ ...closedPhase, updatedBy: 'different-caregiver' }, openedPhase],
    };
    await expect(repository.save(divergent)).rejects.toThrow(
      'Changed phases must exactly match their aggregate representation.',
    );

    const omitted = { ...waking, changedPhases: [closedPhase] };
    await expect(repository.save(omitted)).rejects.toThrow(
      'A sleep mutation must declare every and only changed aggregate phase.',
    );

    const invalidRoot = {
      ...waking,
      operation: { ...waking.operation, entityId: 'different-session' },
    };
    await expect(repository.save(invalidRoot)).rejects.toThrow(
      'A sleep mutation must target its aggregate root and advance one version.',
    );

    const versionJump = {
      ...waking,
      session: { ...waking.session, version: waking.session.version + 2 },
    };
    await expect(repository.save(versionJump)).rejects.toThrow(
      'A sleep mutation must target its aggregate root and advance one version.',
    );

    expect(await repository.active('child-arthur')).toEqual(bedtime.session);
    expect(await repository.pendingOperationCount()).toBe(1);
  });

  it('round-trips Europe/Lisbon DST instants and reports the latest Nap or Night end', async () => {
    const springNight = startNightSleep(context('2026-03-29T00:30:00.000Z'));
    await repository.save(springNight);
    const springWaking = startNightWaking(springNight.session, context('2026-03-29T01:30:00.000Z'));
    await repository.save(springWaking);
    const endedNight = endNightSleep(springWaking.session, context('2026-03-29T02:00:00.000Z'));
    await repository.save(endedNight);

    const nap = startNap(context('2026-03-29T03:00:00.000Z'));
    await repository.save(nap);
    const endedNap = stopNap(nap.session, context('2026-03-29T03:30:00.000Z'));
    await repository.save(endedNap);

    const fallNight = startNightSleep(context('2026-10-25T00:30:00.000Z'));
    await repository.save(fallNight);
    const fallWaking = startNightWaking(fallNight.session, context('2026-10-25T01:30:00.000Z'));
    await repository.save(fallWaking);
    const endedFallNight = endNightSleep(fallWaking.session, context('2026-10-25T02:00:00.000Z'));
    await repository.save(endedFallNight);

    restartDatabase();
    const afterRestart = new SQLiteSleepRepository(adapter.asExpoDatabase());
    expect(await afterRestart.findById(springNight.session.id)).toEqual(endedNight.session);
    expect(await afterRestart.findById(fallNight.session.id)).toEqual(endedFallNight.session);
    expect(await afterRestart.latestCompletedEnd('child-arthur')).toBe('2026-10-25T02:00:00.000Z');
  });

  function restartDatabase(): void {
    database.close();
    database = new DatabaseSync(databasePath);
    adapter = new NodeSQLiteAdapter(database);
  }
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
