/// <reference types="node" />

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import {
  deleteNursing,
  editCompletedNursing,
  endNightSleep,
  type MutationContext,
  type NursingSide,
  pauseNursing,
  restoreNursing,
  resumeNursing,
  startNap,
  startNightSleep,
  startNightWaking,
  startNursing,
  stopNap,
  stopNursing,
  switchNursingSide,
} from '@baby-tracker/domain';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../../storage/migrations';
import { SQLiteSleepRepository } from '../sleep/sqlite-sleep-repository';
import {
  ActiveNursingSessionError,
  NursingWriteConflictError,
  SQLiteNursingRepository,
} from './sqlite-nursing-repository';

describe('SQLite Nursing repository', () => {
  let database: DatabaseSync;
  let adapter: NodeSQLiteAdapter;
  let repository: SQLiteNursingRepository;
  let temporaryDirectory: string;
  let databasePath: string;

  beforeEach(async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'baby-tracker-nursing-sqlite-'));
    databasePath = join(temporaryDirectory, 'baby-tracker.db');
    database = new DatabaseSync(databasePath);
    adapter = new NodeSQLiteAdapter(database);
    await migrateDatabase(adapter.asExpoDatabase());
    repository = new SQLiteNursingRepository(adapter.asExpoDatabase());
  });

  afterEach(() => {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('atomically persists switch, pause, resume, stop, and privacy-minimal outbox payloads', async () => {
    const started = startNursing('left', context('2026-08-15T10:00:00.000Z'));
    await repository.save(started);
    const switched = switchNursingSide(
      started.session,
      'right',
      context('2026-08-15T10:01:30.000Z'),
    );
    await repository.save(switched);
    const paused = pauseNursing(switched.session, context('2026-08-15T10:02:00.000Z'));
    await repository.save(paused);
    const resumed = resumeNursing(paused.session, 'left', context('2026-08-15T10:02:20.000Z'));
    await repository.save(resumed);
    const stopped = stopNursing(resumed.session, context('2026-08-15T10:03:00.000Z'));
    await repository.save(stopped);

    expect(await repository.findById(started.session.id)).toEqual(stopped.session);
    expect(await repository.pendingOperationCount()).toBe(5);
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
    expect(operations.map(({ action }) => action)).toEqual([
      'start_nursing',
      'switch_nursing_side',
      'pause_nursing',
      'resume_nursing',
      'stop_nursing',
    ]);
    expect(operations.map(({ operation_id }) => operation_id)).toEqual([
      '2026-08-15T10:00:00.000Z-id-1',
      '2026-08-15T10:01:30.000Z-id-0',
      '2026-08-15T10:02:00.000Z-id-0',
      '2026-08-15T10:02:20.000Z-id-0',
      '2026-08-15T10:03:00.000Z-id-0',
    ]);
    expect(operations.map(({ entity_id }) => entity_id)).toEqual(
      Array.from({ length: 5 }, () => started.session.id),
    );
    expect(operations.every(({ entity_type }) => entity_type === 'nursing_session')).toBe(true);
    expect(operations.map(({ base_version }) => base_version)).toEqual([null, 1, 2, 3, 4]);
    expect(operations.map(({ client_occurred_at }) => client_occurred_at)).toEqual([
      '2026-08-15T10:00:00.000Z',
      '2026-08-15T10:01:30.000Z',
      '2026-08-15T10:02:00.000Z',
      '2026-08-15T10:02:20.000Z',
      '2026-08-15T10:03:00.000Z',
    ]);
    expect(operations.every(({ client_timezone }) => client_timezone === 'Europe/Lisbon')).toBe(
      true,
    );
    expect(operations.map(({ payload_json }) => JSON.parse(payload_json))).toEqual([
      { startedAt: '2026-08-15T10:00:00.000Z', side: 'left' },
      { transitionAt: '2026-08-15T10:01:30.000Z', side: 'right' },
      { pausedAt: '2026-08-15T10:02:00.000Z' },
      { resumedAt: '2026-08-15T10:02:20.000Z', side: 'left' },
      {
        endedAt: '2026-08-15T10:03:00.000Z',
        leftDurationSeconds: 130,
        rightDurationSeconds: 30,
        totalPauseDurationSeconds: 20,
        lastBreastUsed: 'left',
      },
    ]);
    expect(operations.some(({ payload_json }) => /note|raw|medicine/i.test(payload_json))).toBe(
      false,
    );
  });

  it('atomically edits, deletes, and restores the exact completed Nursing record', async () => {
    const started = startNursing('left', context('2026-08-15T23:59:00.000Z'));
    await repository.save(started);
    const paused = pauseNursing(started.session, context('2026-08-15T23:59:30.000Z'));
    await repository.save(paused);
    const completed = stopNursing(paused.session, context('2026-08-16T00:00:00.000Z'));
    await repository.save(completed);
    const edited = editCompletedNursing(
      completed.session,
      {
        startedAt: new Date('2026-08-15T23:58:30.000Z'),
        endedAt: new Date('2026-08-16T00:00:30.000Z'),
        leftDurationSeconds: 50,
      },
      context('2026-08-16T00:01:00.000Z'),
    );
    await repository.save(edited);

    expect(await repository.findById(started.session.id)).toEqual(edited.session);
    expect(edited.session).toMatchObject({
      id: started.session.id,
      version: 4,
      leftDurationSeconds: 50,
      rightDurationSeconds: 40,
      totalPauseDurationSeconds: 30,
      lastBreastUsed: 'left',
    });
    const editOperation = database
      .prepare(
        `SELECT entity_id, action, base_version, payload_json
         FROM outbox_operations ORDER BY local_sequence DESC LIMIT 1`,
      )
      .get() as {
      entity_id: string;
      action: string;
      base_version: number;
      payload_json: string;
    };
    expect(editOperation).toMatchObject({
      entity_id: started.session.id,
      action: 'edit_nursing_session',
      base_version: 3,
    });
    expect(JSON.parse(editOperation.payload_json)).toEqual({
      startedAt: '2026-08-15T23:58:30.000Z',
      endedAt: '2026-08-16T00:00:30.000Z',
      status: 'completed',
      leftDurationSeconds: 50,
      rightDurationSeconds: 40,
      totalPauseDurationSeconds: 30,
      activeSide: null,
      activeSideStartedAt: null,
      pauseStartedAt: null,
      lastBreastUsed: 'left',
      deletedAt: null,
    });

    const deleted = deleteNursing(edited.session, context('2026-08-16T00:01:10.000Z'));
    await repository.save(deleted);
    expect(await repository.findById(started.session.id)).toEqual(deleted.session);
    expect(
      await repository.listVisible(
        'child-arthur',
        '2026-08-15T00:00:00.000Z',
        '2026-08-17T00:00:00.000Z',
      ),
    ).toEqual([]);

    const restored = restoreNursing(deleted.session, context('2026-08-16T00:01:20.000Z'));
    await repository.save(restored);
    expect(await repository.findById(started.session.id)).toEqual(restored.session);
    expect(restored.session).toMatchObject({ id: started.session.id, version: 6, deletedAt: null });
    expect(
      database
        .prepare('SELECT action, base_version FROM outbox_operations ORDER BY local_sequence')
        .all()
        .slice(-3),
    ).toEqual([
      { action: 'edit_nursing_session', base_version: 3 },
      { action: 'delete_nursing_session', base_version: 4 },
      { action: 'restore_nursing_session', base_version: 5 },
    ]);
  });

  it('rolls back a stale completed edit without mutating its correction proposal', async () => {
    const completed = await completeSession(
      'left',
      '2026-08-15T10:00:00.000Z',
      '2026-08-15T10:01:00.000Z',
    );
    const first = editCompletedNursing(
      completed,
      {
        startedAt: new Date('2026-08-15T10:00:00.000Z'),
        endedAt: new Date('2026-08-15T10:01:10.000Z'),
        leftDurationSeconds: 65,
      },
      context('2026-08-15T10:02:00.000Z'),
    );
    await repository.save(first);
    const stale = editCompletedNursing(
      completed,
      {
        startedAt: new Date('2026-08-15T09:59:50.000Z'),
        endedAt: new Date('2026-08-15T10:01:00.000Z'),
        leftDurationSeconds: 20,
      },
      context('2026-08-15T10:02:10.000Z'),
    );
    const proposal = structuredClone(stale.session);

    await expect(repository.save(stale)).rejects.toBeInstanceOf(NursingWriteConflictError);
    expect(stale.session).toEqual(proposal);
    expect(await repository.findById(completed.id)).toEqual(first.session);
    expect(await repository.pendingOperationCount()).toBe(3);
  });

  it('rejects a tampered edit payload without changing the record or outbox', async () => {
    const completed = await completeSession(
      'left',
      '2026-08-15T10:00:00.000Z',
      '2026-08-15T10:01:00.000Z',
    );
    const edited = editCompletedNursing(
      completed,
      {
        startedAt: new Date(completed.startedAt),
        endedAt: new Date(completed.endedAt ?? ''),
        leftDurationSeconds: 20,
      },
      context('2026-08-15T10:02:00.000Z'),
    );
    Object.assign(edited.operation.payload, { leftDurationSeconds: 21 });

    await expect(repository.save(edited)).rejects.toThrow(
      'A Nursing operation payload must exactly match its aggregate mutation.',
    );
    expect(await repository.findById(completed.id)).toEqual(completed);
    expect(await repository.pendingOperationCount()).toBe(2);
  });

  it('rejects edits that change stored pause or corrupt explicit Last', async () => {
    const started = startNursing('left', context('2026-08-15T10:00:00.000Z'));
    await repository.save(started);
    const paused = pauseNursing(started.session, context('2026-08-15T10:00:30.000Z'));
    await repository.save(paused);
    const resumed = resumeNursing(paused.session, 'right', context('2026-08-15T10:00:40.000Z'));
    await repository.save(resumed);
    const completed = stopNursing(resumed.session, context('2026-08-15T10:01:00.000Z'));
    await repository.save(completed);

    const changedPause = editCompletedNursing(
      completed.session,
      {
        startedAt: new Date(completed.session.startedAt),
        endedAt: new Date(completed.session.endedAt ?? ''),
        leftDurationSeconds: 20,
      },
      context('2026-08-15T10:02:00.000Z'),
    );
    changedPause.session.totalPauseDurationSeconds += 1;
    changedPause.session.rightDurationSeconds -= 1;
    Object.assign(changedPause.operation.payload, {
      totalPauseDurationSeconds: changedPause.session.totalPauseDurationSeconds,
      rightDurationSeconds: changedPause.session.rightDurationSeconds,
    });
    await expect(repository.save(changedPause)).rejects.toThrow(
      'A Nursing edit must preserve the stored pause duration.',
    );

    const changedLast = editCompletedNursing(
      completed.session,
      {
        startedAt: new Date(completed.session.startedAt),
        endedAt: new Date(completed.session.endedAt ?? ''),
        leftDurationSeconds: 20,
      },
      context('2026-08-15T10:02:10.000Z'),
    );
    changedLast.session.lastBreastUsed = 'left';
    Object.assign(changedLast.operation.payload, { lastBreastUsed: 'left' });
    await expect(repository.save(changedLast)).rejects.toThrow(
      'A Nursing edit must preserve or deterministically correct Last.',
    );

    expect(await repository.findById(completed.session.id)).toEqual(completed.session);
    expect(await repository.pendingOperationCount()).toBe(4);
  });

  it('rejects delete and restore mutations that alter the completed business record', async () => {
    const completed = await completeSession(
      'right',
      '2026-08-15T10:00:00.000Z',
      '2026-08-15T10:01:00.000Z',
    );
    const tamperedDelete = deleteNursing(completed, context('2026-08-15T10:02:00.000Z'));
    tamperedDelete.session.startedAt = '2026-08-15T09:59:59.000Z';
    tamperedDelete.session.endedAt = '2026-08-15T10:00:59.000Z';
    await expect(repository.save(tamperedDelete)).rejects.toThrow(
      'Nursing delete and restore must preserve the exact completed record.',
    );
    expect(await repository.findById(completed.id)).toEqual(completed);
    expect(await repository.pendingOperationCount()).toBe(2);

    const deleted = deleteNursing(completed, context('2026-08-15T10:02:10.000Z'));
    await repository.save(deleted);
    const tamperedRestore = restoreNursing(deleted.session, context('2026-08-15T10:02:20.000Z'));
    tamperedRestore.session.startedAt = '2026-08-15T09:59:59.000Z';
    tamperedRestore.session.endedAt = '2026-08-15T10:00:59.000Z';
    await expect(repository.save(tamperedRestore)).rejects.toThrow(
      'Nursing delete and restore must preserve the exact completed record.',
    );
    expect(await repository.findById(completed.id)).toEqual(deleted.session);
    expect(await repository.pendingOperationCount()).toBe(3);
  });

  it.each([
    ['left', 'active'],
    ['right', 'active'],
    ['left', 'paused'],
  ] as const)('recovers %s Nursing in %s state after restart', async (side, state) => {
    const started = startNursing(side, context('2026-08-15T10:00:00.000Z'));
    await repository.save(started);
    const expected =
      state === 'paused'
        ? pauseNursing(started.session, context('2026-08-15T10:00:30.000Z'))
        : started;
    if (state === 'paused') await repository.save(expected);

    restartDatabase();
    const afterRestart = new SQLiteNursingRepository(adapter.asExpoDatabase());

    expect(await afterRestart.active('child-arthur')).toEqual(expected.session);
  });

  it('resumes a persisted open pause after restart without losing pause or side totals', async () => {
    const started = startNursing('left', context('2026-08-15T10:00:00.000Z'));
    await repository.save(started);
    const paused = pauseNursing(started.session, context('2026-08-15T10:00:30.000Z'));
    await repository.save(paused);

    restartDatabase();
    repository = new SQLiteNursingRepository(adapter.asExpoDatabase());
    const recovered = await repository.active('child-arthur');
    if (recovered === null) throw new Error('Expected persisted paused Nursing.');
    const resumed = resumeNursing(recovered, 'right', context('2026-08-15T10:00:50.000Z'));
    await repository.save(resumed);
    const stopped = stopNursing(resumed.session, context('2026-08-15T10:01:10.000Z'));
    await repository.save(stopped);

    expect(stopped.session).toMatchObject({
      leftDurationSeconds: 30,
      rightDurationSeconds: 20,
      totalPauseDurationSeconds: 20,
      lastBreastUsed: 'right',
    });
  });

  it('returns neutral history first, then the latest non-deleted completed explicit Last', async () => {
    expect(await repository.latestCompletedLastBreast('child-arthur')).toBeNull();

    const first = await completeSession(
      'left',
      '2026-08-15T10:00:00.000Z',
      '2026-08-15T10:01:00.000Z',
    );
    expect(await repository.latestCompletedLastBreast('child-arthur')).toBe('left');

    const secondStart = startNursing('right', context('2026-08-15T11:00:00.000Z'));
    await repository.save(secondStart);
    const paused = pauseNursing(secondStart.session, context('2026-08-15T11:00:10.000Z'));
    await repository.save(paused);
    expect(await repository.latestCompletedLastBreast('child-arthur')).toBe('left');
    const second = stopNursing(paused.session, context('2026-08-15T11:00:20.000Z'));
    await repository.save(second);
    expect(await repository.latestCompletedLastBreast('child-arthur')).toBe('right');

    await repository.save(deleteNursing(second.session, context('2026-08-15T11:01:00.000Z')));
    expect(await repository.latestCompletedLastBreast('child-arthur')).toBe('left');
    expect(first.lastBreastUsed).toBe('left');
  });

  it('breaks equal completed-end chronology ties by start and then stable ID', async () => {
    await completeSession('left', '2026-08-15T10:00:00.000Z', '2026-08-15T10:02:00.000Z');

    const laterStart = startNursing(
      'right',
      context('2026-08-15T10:03:00.000Z'),
      new Date('2026-08-15T10:01:00.000Z'),
    );
    await repository.save(laterStart);
    await repository.save(
      stopNursing(
        laterStart.session,
        context('2026-08-15T10:04:00.000Z'),
        new Date('2026-08-15T10:02:00.000Z'),
      ),
    );
    expect(await repository.latestCompletedLastBreast('child-arthur')).toBe('right');

    const higherId = startNursing(
      'left',
      context('2026-08-15T10:05:00.000Z'),
      new Date('2026-08-15T10:01:00.000Z'),
    );
    await repository.save(higherId);
    await repository.save(
      stopNursing(
        higherId.session,
        context('2026-08-15T10:06:00.000Z'),
        new Date('2026-08-15T10:02:00.000Z'),
      ),
    );
    expect(await repository.latestCompletedLastBreast('child-arthur')).toBe('left');
  });

  it('allows Nursing to coexist with Nap, Night asleep, and Night awake states', async () => {
    const sleepRepository = new SQLiteSleepRepository(adapter.asExpoDatabase());
    const night = startNightSleep(context('2026-08-15T20:30:00.000Z'));
    await sleepRepository.save(night);
    const nursing = startNursing('right', context('2026-08-15T21:00:00.000Z'));
    await repository.save(nursing);

    expect(await sleepRepository.active('child-arthur')).toEqual(night.session);
    expect(await repository.active('child-arthur')).toEqual(nursing.session);

    const nightWaking = startNightWaking(night.session, context('2026-08-16T01:00:00.000Z'));
    await sleepRepository.save(nightWaking);
    expect((await sleepRepository.active('child-arthur'))?.phases.at(-1)?.kind).toBe('awake');
    expect(await repository.active('child-arthur')).toEqual(nursing.session);

    await sleepRepository.save(
      endNightSleep(nightWaking.session, context('2026-08-16T06:00:00.000Z')),
    );
    const stoppedNursing = stopNursing(nursing.session, context('2026-08-16T06:01:00.000Z'));
    await repository.save(stoppedNursing);

    const nap = startNap(context('2026-08-16T09:00:00.000Z'));
    await sleepRepository.save(nap);
    const nursingDuringNap = startNursing('left', context('2026-08-16T09:05:00.000Z'));
    await repository.save(nursingDuringNap);
    expect((await sleepRepository.active('child-arthur'))?.kind).toBe('nap');
    expect(await repository.active('child-arthur')).toEqual(nursingDuringNap.session);
    await sleepRepository.save(stopNap(nap.session, context('2026-08-16T09:30:00.000Z')));
  });

  it('rejects a second active or paused Nursing session without touching outbox', async () => {
    const first = startNursing('left', context('2026-08-15T10:00:00.000Z'));
    await repository.save(first);
    const paused = pauseNursing(first.session, context('2026-08-15T10:00:30.000Z'));
    await repository.save(paused);
    const second = startNursing('right', context('2026-08-15T10:01:00.000Z'));

    await expect(repository.save(second)).rejects.toBeInstanceOf(ActiveNursingSessionError);
    expect(await repository.active('child-arthur')).toEqual(paused.session);
    expect(await repository.pendingOperationCount()).toBe(2);
  });

  it('rolls back stale versions and duplicate outbox operations', async () => {
    const started = startNursing('left', context('2026-08-15T10:00:00.000Z'));
    await repository.save(started);
    const switched = switchNursingSide(
      started.session,
      'right',
      context('2026-08-15T10:01:00.000Z'),
    );
    await repository.save(switched);

    const stalePause = pauseNursing(started.session, context('2026-08-15T10:01:10.000Z'));
    await expect(repository.save(stalePause)).rejects.toBeInstanceOf(NursingWriteConflictError);

    const duplicateOutboxPause = pauseNursing(
      switched.session,
      context('2026-08-15T10:01:20.000Z'),
    );
    duplicateOutboxPause.operation.operationId = switched.operation.operationId;
    await expect(repository.save(duplicateOutboxPause)).rejects.toThrow();

    expect(await repository.active('child-arthur')).toEqual(switched.session);
    expect(await repository.pendingOperationCount()).toBe(2);
  });

  it('rejects missing update roots, duplicate creates, immutable changes, and invalid action classes', async () => {
    const missingStart = startNursing('left', context('2026-08-15T09:00:00.000Z'));
    const missingUpdate = switchNursingSide(
      missingStart.session,
      'right',
      context('2026-08-15T09:00:10.000Z'),
    );
    await expect(repository.save(missingUpdate)).rejects.toBeInstanceOf(NursingWriteConflictError);
    expect(await repository.pendingOperationCount()).toBe(0);

    const started = startNursing('left', context('2026-08-15T10:00:00.000Z'));
    await repository.save(started);
    await expect(repository.save(started)).rejects.toBeInstanceOf(NursingWriteConflictError);

    for (const immutablePatch of [
      { childId: 'different-child' },
      { timezone: 'UTC' },
      { createdBy: 'different-caregiver' },
    ]) {
      const immutableChange = switchNursingSide(
        started.session,
        'right',
        context('2026-08-15T10:00:10.000Z'),
      );
      Object.assign(immutableChange.session, immutablePatch);
      await expect(repository.save(immutableChange)).rejects.toThrow(
        'A Nursing update cannot change immutable aggregate ownership fields.',
      );
    }

    const invalidAction = switchNursingSide(
      started.session,
      'right',
      context('2026-08-15T10:00:20.000Z'),
    );
    invalidAction.operation.action = 'start_nursing';
    await expect(repository.save(invalidAction)).rejects.toThrow(
      'Only a new Nursing aggregate can use the start action.',
    );

    const invalidTransition = pauseNursing(started.session, context('2026-08-15T10:00:25.000Z'));
    invalidTransition.operation.action = 'switch_nursing_side';
    await expect(repository.save(invalidTransition)).rejects.toThrow(
      'The Nursing action does not match the stored lifecycle transition.',
    );

    const invalidTombstone = switchNursingSide(
      started.session,
      'right',
      context('2026-08-15T10:00:30.000Z'),
    );
    invalidTombstone.session.deletedAt = '2026-08-15T10:00:30.000Z';
    await expect(repository.save(invalidTombstone)).rejects.toThrow(
      'Only the Nursing delete action can produce a tombstone.',
    );
    expect(await repository.active('child-arthur')).toEqual(started.session);
    expect(await repository.pendingOperationCount()).toBe(1);
  });

  it('restores only completed stable IDs and keeps explicit Last chronological', async () => {
    const first = await completeSession(
      'left',
      '2026-08-15T10:00:00.000Z',
      '2026-08-15T10:00:30.000Z',
    );
    const deleted = deleteNursing(first, context('2026-08-15T10:00:40.000Z'));
    await repository.save(deleted);
    expect(await repository.latestCompletedLastBreast('child-arthur')).toBeNull();

    await completeSession('right', '2026-08-15T11:00:00.000Z', '2026-08-15T11:00:30.000Z');
    const restored = restoreNursing(deleted.session, context('2026-08-15T11:01:00.000Z'));
    await repository.save(restored);
    expect(await repository.latestCompletedLastBreast('child-arthur')).toBe('right');
    expect(await repository.findById(first.id)).toEqual(restored.session);
    expect(restored.session).toMatchObject({ id: first.id, version: 4, deletedAt: null });

    await expect(repository.save(restored)).rejects.toBeInstanceOf(NursingWriteConflictError);
    expect(await repository.pendingOperationCount()).toBe(6);
  });

  it('accrues real UTC seconds across Lisbon DST and resumes a pause after restart', async () => {
    const started = startNursing('left', context('2026-03-29T00:30:00.000Z'));
    await repository.save(started);
    const paused = pauseNursing(started.session, context('2026-03-29T01:30:00.000Z'));
    await repository.save(paused);

    restartDatabase();
    repository = new SQLiteNursingRepository(adapter.asExpoDatabase());
    const recovered = await repository.active('child-arthur');
    if (recovered === null) throw new Error('Expected persisted DST Nursing pause.');
    const resumed = resumeNursing(recovered, 'right', context('2026-03-29T01:45:00.000Z'));
    await repository.save(resumed);
    const stopped = stopNursing(resumed.session, context('2026-03-29T02:15:00.000Z'));
    await repository.save(stopped);

    expect(stopped.session).toMatchObject({
      leftDurationSeconds: 60 * 60,
      rightDurationSeconds: 30 * 60,
      totalPauseDurationSeconds: 15 * 60,
      timezone: 'Europe/Lisbon',
    });
  });

  it('lists a cross-midnight session on every intersected half-open calendar day', async () => {
    const started = startNursing('left', context('2026-08-15T23:55:00.000Z'));
    await repository.save(started);
    await repository.save(stopNursing(started.session, context('2026-08-16T00:05:00.000Z')));

    expect(
      await repository.listVisible(
        'child-arthur',
        '2026-08-15T00:00:00.000Z',
        '2026-08-16T00:00:00.000Z',
      ),
    ).toHaveLength(1);
    expect(
      await repository.listVisible(
        'child-arthur',
        '2026-08-16T00:00:00.000Z',
        '2026-08-17T00:00:00.000Z',
      ),
    ).toHaveLength(1);
  });

  async function completeSession(side: NursingSide, startedAt: string, endedAt: string) {
    const started = startNursing(side, context(startedAt));
    await repository.save(started);
    const completed = stopNursing(started.session, context(endedAt));
    await repository.save(completed);
    return completed.session;
  }

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
