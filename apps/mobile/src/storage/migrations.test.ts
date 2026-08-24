/// <reference types="node" />

import type { SQLiteDatabase } from 'expo-sqlite';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
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

    expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
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
});

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
