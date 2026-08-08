import type { SQLiteDatabase } from 'expo-sqlite';

const DATABASE_VERSION = 1;

export async function migrateDatabase(database: SQLiteDatabase): Promise<void> {
  await database.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

  const row = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = row?.user_version ?? 0;

  if (currentVersion > DATABASE_VERSION) {
    throw new Error('This app is older than the local database. Please update the app.');
  }

  if (currentVersion === 0) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(`
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

        PRAGMA user_version = ${DATABASE_VERSION};
      `);
    });
  }
}
