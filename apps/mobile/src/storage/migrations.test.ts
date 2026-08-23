/// <reference types="node" />

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from './migrations';

describe('mobile database migrations', () => {
  let database: DatabaseSync | undefined;

  afterEach(() => database?.close());

  it('upgrades a PR #10 database without changing active, completed, or deleted Naps', async () => {
    database = new DatabaseSync(':memory:');
    createVersionOneDatabase(database);
    const beforeSessions = database.prepare('SELECT * FROM sleep_sessions ORDER BY id').all();
    const beforePhases = database.prepare('SELECT * FROM sleep_phases ORDER BY id').all();
    const beforeOutbox = database
      .prepare('SELECT * FROM outbox_operations ORDER BY operation_id')
      .all();

    const adapter = new NodeSQLiteAdapter(database);
    await migrateDatabase(adapter.asExpoDatabase());
    await migrateDatabase(adapter.asExpoDatabase());

    expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 4 });
    expect(database.prepare('SELECT * FROM sleep_sessions ORDER BY id').all()).toEqual(
      beforeSessions,
    );
    expect(database.prepare('SELECT * FROM sleep_phases ORDER BY id').all()).toEqual(beforePhases);
    expect(database.prepare('SELECT * FROM outbox_operations ORDER BY operation_id').all()).toEqual(
      beforeOutbox,
    );
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get('one_open_phase_per_session'),
    ).toEqual({ name: 'one_open_phase_per_session' });

    expect(() =>
      database
        ?.prepare(
          `INSERT INTO sleep_phases (
            id, sleep_session_id, kind, started_at, ended_at,
            created_by, updated_by, version, deleted_at
          ) VALUES (?, ?, ?, ?, NULL, ?, ?, 1, NULL)`,
        )
        .run(
          'invalid-second-open-phase',
          'active-nap',
          'awake',
          '2026-08-12T12:10:00.000Z',
          'caregiver-paloma',
          'caregiver-paloma',
        ),
    ).toThrow();
  });

  it('upgrades version 2 in place and enforces canonical Nursing open-state combinations', async () => {
    database = new DatabaseSync(':memory:');
    createVersionTwoDatabase(database);
    const beforeSessions = database.prepare('SELECT * FROM sleep_sessions ORDER BY id').all();
    const beforeOutbox = database
      .prepare('SELECT * FROM outbox_operations ORDER BY operation_id')
      .all();
    const adapter = new NodeSQLiteAdapter(database);

    await migrateDatabase(adapter.asExpoDatabase());
    await migrateDatabase(adapter.asExpoDatabase());

    expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 4 });
    expect(database.prepare('SELECT * FROM sleep_sessions ORDER BY id').all()).toEqual(
      beforeSessions,
    );
    expect(database.prepare('SELECT * FROM outbox_operations ORDER BY operation_id').all()).toEqual(
      beforeOutbox,
    );

    database
      .prepare(
        `INSERT INTO nursing_sessions (
          id, child_id, started_at, ended_at, status,
          left_duration_seconds, right_duration_seconds, total_pause_duration_seconds,
          active_side, active_side_started_at, pause_started_at, last_breast_used,
          timezone, created_by, updated_by, version, deleted_at
        ) VALUES (?, ?, ?, NULL, 'active', 0, 0, 0, 'left', ?, NULL, 'left', ?, ?, ?, 1, NULL)`,
      )
      .run(
        'active-nursing',
        'child-arthur',
        '2026-08-12T12:00:00.000Z',
        '2026-08-12T12:00:00.000Z',
        'Europe/Lisbon',
        'caregiver-paloma',
        'caregiver-paloma',
      );

    expect(() =>
      database
        ?.prepare(
          `INSERT INTO nursing_sessions (
            id, child_id, started_at, ended_at, status,
            left_duration_seconds, right_duration_seconds, total_pause_duration_seconds,
            active_side, active_side_started_at, pause_started_at, last_breast_used,
            timezone, created_by, updated_by, version, deleted_at
          ) VALUES (?, ?, ?, NULL, 'paused', 0, 0, 0, 'right', NULL, ?, 'right', ?, ?, ?, 1, NULL)`,
        )
        .run(
          'invalid-paused-nursing',
          'another-child',
          '2026-08-12T12:00:00.000Z',
          '2026-08-12T12:10:00.000Z',
          'Europe/Lisbon',
          'caregiver-paloma',
          'caregiver-paloma',
        ),
    ).toThrow();

    expect(() =>
      database
        ?.prepare(
          `INSERT INTO nursing_sessions (
            id, child_id, started_at, ended_at, status,
            left_duration_seconds, right_duration_seconds, total_pause_duration_seconds,
            active_side, active_side_started_at, pause_started_at, last_breast_used,
            timezone, created_by, updated_by, version, deleted_at
          ) VALUES (?, ?, ?, NULL, 'active', 0, 0, 0, 'right', ?, NULL, 'right', ?, ?, ?, 1, NULL)`,
        )
        .run(
          'second-active-nursing',
          'child-arthur',
          '2026-08-12T12:10:00.000Z',
          '2026-08-12T12:10:00.000Z',
          'Europe/Lisbon',
          'caregiver-paloma',
          'caregiver-paloma',
        ),
    ).toThrow();

    expect(() =>
      database
        ?.prepare(
          `INSERT INTO nursing_sessions (
            id, child_id, started_at, ended_at, status,
            left_duration_seconds, right_duration_seconds, total_pause_duration_seconds,
            active_side, active_side_started_at, pause_started_at, last_breast_used,
            timezone, created_by, updated_by, version, deleted_at
          ) VALUES (?, ?, ?, NULL, 'active', 0, 0, 0, 'left', ?, NULL, 'right', ?, ?, ?, 1, NULL)`,
        )
        .run(
          'invalid-last-side',
          'another-child',
          '2026-08-12T12:10:00.000Z',
          '2026-08-12T12:10:00.000Z',
          'Europe/Lisbon',
          'caregiver-paloma',
          'caregiver-paloma',
        ),
    ).toThrow();
  });

  it('rejects noncanonical Nursing instants, versions, boundaries, and completed totals in SQLite', async () => {
    const nursingDatabase = new DatabaseSync(':memory:');
    database = nursingDatabase;
    createVersionTwoDatabase(nursingDatabase);
    await migrateDatabase(new NodeSQLiteAdapter(nursingDatabase).asExpoDatabase());

    const active = directNursingRow();
    const invalidRows: DirectNursingRow[] = [
      {
        ...active,
        id: 'fractional-boundary',
        startedAt: '2026-08-12T12:00:00.500Z',
        activeSideStartedAt: '2026-08-12T12:00:00.500Z',
      },
      { ...active, id: 'fractional-version', version: 1.5 },
      {
        ...active,
        id: 'reversed-active-boundary',
        activeSideStartedAt: '2026-08-12T11:59:59.000Z',
      },
      {
        ...active,
        id: 'reversed-pause-boundary',
        status: 'paused',
        activeSide: null,
        activeSideStartedAt: null,
        pauseStartedAt: '2026-08-12T11:59:59.000Z',
      },
      {
        ...active,
        id: 'invalid-completed-total',
        status: 'completed',
        endedAt: '2026-08-12T12:01:00.000Z',
        activeSide: null,
        activeSideStartedAt: null,
        leftDurationSeconds: 59,
      },
      {
        ...active,
        id: 'invalid-calendar-date',
        startedAt: '2026-02-30T12:00:00.000Z',
        activeSideStartedAt: '2026-02-30T12:00:00.000Z',
      },
    ];

    for (const row of invalidRows) {
      expect(() => insertDirectNursing(nursingDatabase, row)).toThrow();
    }

    insertDirectNursing(nursingDatabase, {
      ...active,
      id: 'valid-completed',
      status: 'completed',
      endedAt: '2026-08-12T12:01:00.000Z',
      activeSide: null,
      activeSideStartedAt: null,
      leftDurationSeconds: 60,
    });
    expect(nursingDatabase.prepare('SELECT COUNT(*) AS count FROM nursing_sessions').get()).toEqual(
      { count: 1 },
    );
  });

  it('upgrades a version 3 database after Nursing without changing existing data', async () => {
    database = new DatabaseSync(':memory:');
    createVersionThreeDatabase(database);
    const beforeNursing = database.prepare('SELECT * FROM nursing_sessions').all();
    const beforeSleep = database.prepare('SELECT * FROM sleep_sessions ORDER BY id').all();
    const adapter = new NodeSQLiteAdapter(database);

    await migrateDatabase(adapter.asExpoDatabase());
    await migrateDatabase(adapter.asExpoDatabase());

    expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 4 });
    expect(database.prepare('SELECT * FROM nursing_sessions').all()).toEqual(beforeNursing);
    expect(database.prepare('SELECT * FROM sleep_sessions ORDER BY id').all()).toEqual(beforeSleep);
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'care_events'")
        .get(),
    ).toEqual({ name: 'care_events' });
  });

  it('enforces canonical typed care-event rows directly in SQLite', async () => {
    const careDatabase = new DatabaseSync(':memory:');
    database = careDatabase;
    await migrateDatabase(new NodeSQLiteAdapter(careDatabase).asExpoDatabase());

    const validDiaper = directCareEventRow();
    const invalidRows: DirectCareEventRow[] = [
      { ...validDiaper, id: 'bath', kind: 'bath' },
      { ...validDiaper, id: 'malformed-json', dataJson: '{' },
      { ...validDiaper, id: 'mismatched-data', kind: 'medicine' },
      { ...validDiaper, id: 'invalid-diaper', dataJson: '{"diaperType":"damp"}' },
      {
        ...validDiaper,
        id: 'empty-medicine',
        kind: 'medicine',
        dataJson: '{"note":" \\n \\t"}',
      },
      { ...validDiaper, id: 'fractional-version', version: 1.5 },
      { ...validDiaper, id: 'invalid-date', occurredAt: '2026-02-30T12:00:00.000Z' },
      { ...validDiaper, id: 'noncanonical-instant', occurredAt: '2026-08-15 12:00:00Z' },
      { ...validDiaper, id: 'early-deletion', deletedAt: '2026-08-15T11:59:59.999Z' },
    ];

    for (const row of invalidRows) {
      expect(() => insertDirectCareEvent(careDatabase, row), row.id).toThrow();
    }

    insertDirectCareEvent(careDatabase, validDiaper);
    insertDirectCareEvent(careDatabase, {
      ...validDiaper,
      id: 'valid-medicine',
      kind: 'medicine',
      dataJson: '{"note":"  unrestricted text  "}',
    });
    expect(careDatabase.prepare('SELECT COUNT(*) AS count FROM care_events').get()).toEqual({
      count: 2,
    });
  });

  it('rolls back a failed version 3 care-event migration', async () => {
    database = new DatabaseSync(':memory:');
    createVersionThreeDatabase(database);
    database.exec('CREATE TABLE care_events (sentinel TEXT);');
    const beforeNursing = database.prepare('SELECT * FROM nursing_sessions').all();

    await expect(
      migrateDatabase(new NodeSQLiteAdapter(database).asExpoDatabase()),
    ).rejects.toThrow();

    expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 3 });
    expect(database.prepare('SELECT * FROM nursing_sessions').all()).toEqual(beforeNursing);
    expect(database.prepare('PRAGMA table_info(care_events)').all()).toMatchObject([
      { name: 'sentinel' },
    ]);
  });

  it('rolls back version 1 additions when care-event schema creation fails', async () => {
    database = new DatabaseSync(':memory:');
    createVersionOneDatabase(database);
    database.exec('CREATE TABLE care_events (sentinel TEXT);');
    const beforeSleep = database.prepare('SELECT * FROM sleep_sessions ORDER BY id').all();
    const beforeOutbox = database
      .prepare('SELECT * FROM outbox_operations ORDER BY operation_id')
      .all();

    await expect(
      migrateDatabase(new NodeSQLiteAdapter(database).asExpoDatabase()),
    ).rejects.toThrow();

    expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
    expect(database.prepare('SELECT * FROM sleep_sessions ORDER BY id').all()).toEqual(beforeSleep);
    expect(database.prepare('SELECT * FROM outbox_operations ORDER BY operation_id').all()).toEqual(
      beforeOutbox,
    );
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'nursing_sessions'",
        )
        .get(),
    ).toBeUndefined();
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'one_open_phase_per_session'",
        )
        .get(),
    ).toBeUndefined();
    expect(database.prepare('PRAGMA table_info(care_events)').all()).toMatchObject([
      { name: 'sentinel' },
    ]);
  });

  it('rolls back version 2 Nursing creation when care-event schema creation fails', async () => {
    database = new DatabaseSync(':memory:');
    createVersionTwoDatabase(database);
    database.exec('CREATE TABLE care_events (sentinel TEXT);');
    const beforeSleep = database.prepare('SELECT * FROM sleep_sessions ORDER BY id').all();

    await expect(
      migrateDatabase(new NodeSQLiteAdapter(database).asExpoDatabase()),
    ).rejects.toThrow();

    expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
    expect(database.prepare('SELECT * FROM sleep_sessions ORDER BY id').all()).toEqual(beforeSleep);
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'nursing_sessions'",
        )
        .get(),
    ).toBeUndefined();
    expect(database.prepare('PRAGMA table_info(care_events)').all()).toMatchObject([
      { name: 'sentinel' },
    ]);
  });

  it('rejects a future database version without mutating its schema', async () => {
    database = new DatabaseSync(':memory:');
    database.exec('PRAGMA user_version = 5;');

    await expect(migrateDatabase(new NodeSQLiteAdapter(database).asExpoDatabase())).rejects.toThrow(
      'This app is older than the local database. Please update the app.',
    );
    expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 5 });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'nursing_sessions'",
        )
        .get(),
    ).toBeUndefined();
  });

  it('rolls back a failed version 2 migration without advancing user_version', async () => {
    database = new DatabaseSync(':memory:');
    createVersionTwoDatabase(database);
    database.exec('CREATE TABLE nursing_sessions (sentinel TEXT);');
    const beforeSleep = database.prepare('SELECT * FROM sleep_sessions ORDER BY id').all();

    await expect(
      migrateDatabase(new NodeSQLiteAdapter(database).asExpoDatabase()),
    ).rejects.toThrow();
    expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
    expect(database.prepare('SELECT * FROM sleep_sessions ORDER BY id').all()).toEqual(beforeSleep);
    expect(database.prepare('PRAGMA table_info(nursing_sessions)').all()).toMatchObject([
      { name: 'sentinel' },
    ]);
  });
});

interface DirectCareEventRow {
  id: string;
  childId: string;
  kind: string;
  occurredAt: string;
  timezone: string;
  dataJson: string;
  createdBy: string;
  updatedBy: string;
  version: number;
  deletedAt: string | null;
}

function directCareEventRow(): DirectCareEventRow {
  return {
    id: 'valid-diaper',
    childId: 'child-arthur',
    kind: 'diaper',
    occurredAt: '2026-08-15T12:00:00.125Z',
    timezone: 'Europe/Lisbon',
    dataJson: '{"diaperType":"wet"}',
    createdBy: 'caregiver-paloma',
    updatedBy: 'caregiver-paloma',
    version: 1,
    deletedAt: null,
  };
}

function insertDirectCareEvent(database: DatabaseSync, row: DirectCareEventRow): void {
  database
    .prepare(
      `INSERT INTO care_events (
        id, child_id, kind, occurred_at, timezone, data_json,
        created_by, updated_by, version, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.childId,
      row.kind,
      row.occurredAt,
      row.timezone,
      row.dataJson,
      row.createdBy,
      row.updatedBy,
      row.version,
      row.deletedAt,
    );
}

interface DirectNursingRow {
  id: string;
  childId: string;
  startedAt: string;
  endedAt: string | null;
  status: 'active' | 'paused' | 'completed';
  leftDurationSeconds: number;
  rightDurationSeconds: number;
  totalPauseDurationSeconds: number;
  activeSide: 'left' | 'right' | null;
  activeSideStartedAt: string | null;
  pauseStartedAt: string | null;
  lastBreastUsed: 'left' | 'right';
  timezone: string;
  createdBy: string;
  updatedBy: string;
  version: number;
  deletedAt: string | null;
}

function directNursingRow(): DirectNursingRow {
  return {
    id: 'active-nursing',
    childId: 'child-arthur',
    startedAt: '2026-08-12T12:00:00.000Z',
    endedAt: null,
    status: 'active',
    leftDurationSeconds: 0,
    rightDurationSeconds: 0,
    totalPauseDurationSeconds: 0,
    activeSide: 'left',
    activeSideStartedAt: '2026-08-12T12:00:00.000Z',
    pauseStartedAt: null,
    lastBreastUsed: 'left',
    timezone: 'Europe/Lisbon',
    createdBy: 'caregiver-paloma',
    updatedBy: 'caregiver-paloma',
    version: 1,
    deletedAt: null,
  };
}

function insertDirectNursing(database: DatabaseSync, row: DirectNursingRow): void {
  database
    .prepare(
      `INSERT INTO nursing_sessions (
        id, child_id, started_at, ended_at, status,
        left_duration_seconds, right_duration_seconds, total_pause_duration_seconds,
        active_side, active_side_started_at, pause_started_at, last_breast_used,
        timezone, created_by, updated_by, version, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.childId,
      row.startedAt,
      row.endedAt,
      row.status,
      row.leftDurationSeconds,
      row.rightDurationSeconds,
      row.totalPauseDurationSeconds,
      row.activeSide,
      row.activeSideStartedAt,
      row.pauseStartedAt,
      row.lastBreastUsed,
      row.timezone,
      row.createdBy,
      row.updatedBy,
      row.version,
      row.deletedAt,
    );
}

function createVersionTwoDatabase(database: DatabaseSync): void {
  createVersionOneDatabase(database);
  database.exec(`
    CREATE UNIQUE INDEX one_open_phase_per_session
      ON sleep_phases (sleep_session_id)
      WHERE ended_at IS NULL AND deleted_at IS NULL;
    PRAGMA user_version = 2;
  `);
}

function createVersionThreeDatabase(database: DatabaseSync): void {
  createVersionTwoDatabase(database);
  database.exec(`
    CREATE TABLE nursing_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      child_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL,
      left_duration_seconds INTEGER NOT NULL,
      right_duration_seconds INTEGER NOT NULL,
      total_pause_duration_seconds INTEGER NOT NULL,
      active_side TEXT,
      active_side_started_at TEXT,
      pause_started_at TEXT,
      last_breast_used TEXT NOT NULL,
      timezone TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      version INTEGER NOT NULL,
      deleted_at TEXT
    );

    INSERT INTO nursing_sessions VALUES (
      'completed-nursing', 'child-arthur', '2026-08-12T10:00:00.000Z',
      '2026-08-12T10:01:00.000Z', 'completed', 60, 0, 0, NULL, NULL, NULL,
      'left', 'Europe/Lisbon', 'caregiver-paloma', 'caregiver-paloma', 2, NULL
    );

    PRAGMA user_version = 3;
  `);
}

function createVersionOneDatabase(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE sleep_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      child_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('nap', 'night')),
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL CHECK (status IN ('active', 'completed')),
      timezone TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version > 0),
      deleted_at TEXT
    );

    CREATE UNIQUE INDEX one_active_sleep_per_child
      ON sleep_sessions (child_id)
      WHERE status = 'active' AND deleted_at IS NULL;

    CREATE TABLE sleep_phases (
      id TEXT PRIMARY KEY NOT NULL,
      sleep_session_id TEXT NOT NULL REFERENCES sleep_sessions(id),
      kind TEXT NOT NULL CHECK (kind IN ('asleep', 'awake')),
      started_at TEXT NOT NULL,
      ended_at TEXT,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version > 0),
      deleted_at TEXT
    );

    CREATE INDEX sleep_phases_session_started_at
      ON sleep_phases (sleep_session_id, started_at);

    CREATE TABLE outbox_operations (
      local_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT UNIQUE NOT NULL,
      entity_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      action TEXT NOT NULL,
      base_version INTEGER,
      client_occurred_at TEXT NOT NULL,
      client_timezone TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'accepted', 'needs_resolution')),
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX pending_outbox_in_creation_order
      ON outbox_operations (local_sequence)
      WHERE state = 'pending';

    INSERT INTO sleep_sessions VALUES
      ('active-nap', 'child-arthur', 'nap', '2026-08-12T12:00:00.000Z', NULL,
       'active', 'Europe/Lisbon', 'caregiver-paloma', 'caregiver-paloma', 1, NULL),
      ('completed-nap', 'child-arthur', 'nap', '2026-08-12T09:00:00.000Z',
       '2026-08-12T09:30:00.000Z', 'completed', 'Europe/Lisbon',
       'caregiver-paloma', 'caregiver-paloma', 2, NULL),
      ('deleted-nap', 'child-arthur', 'nap', '2026-08-11T09:00:00.000Z',
       '2026-08-11T09:30:00.000Z', 'completed', 'Europe/Lisbon',
       'caregiver-paloma', 'caregiver-paloma', 3, '2026-08-12T10:00:00.000Z');

    INSERT INTO sleep_phases VALUES
      ('active-phase', 'active-nap', 'asleep', '2026-08-12T12:00:00.000Z', NULL,
       'caregiver-paloma', 'caregiver-paloma', 1, NULL),
      ('completed-phase', 'completed-nap', 'asleep', '2026-08-12T09:00:00.000Z',
       '2026-08-12T09:30:00.000Z', 'caregiver-paloma', 'caregiver-paloma', 2, NULL),
      ('deleted-phase', 'deleted-nap', 'asleep', '2026-08-11T09:00:00.000Z',
       '2026-08-11T09:30:00.000Z', 'caregiver-paloma', 'caregiver-paloma', 3,
       '2026-08-12T10:00:00.000Z');

    INSERT INTO outbox_operations (
      operation_id, entity_id, entity_type, action, base_version,
      client_occurred_at, client_timezone, payload_json, created_at
    ) VALUES (
      'active-operation', 'active-nap', 'sleep_session', 'start_nap', NULL,
      '2026-08-12T12:00:00.000Z', 'Europe/Lisbon', '{}', '2026-08-12T12:00:00.000Z'
    );

    PRAGMA user_version = 1;
  `);
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
