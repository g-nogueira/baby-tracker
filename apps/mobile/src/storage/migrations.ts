import type { SQLiteDatabase } from 'expo-sqlite';

const DATABASE_VERSION = 4;

const CREATE_CARE_EVENTS_SCHEMA = `
  CREATE TABLE care_events (
    id TEXT PRIMARY KEY NOT NULL,
    child_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('diaper', 'medicine')),
    occurred_at TEXT NOT NULL,
    timezone TEXT NOT NULL CHECK (length(timezone) > 0),
    data_json TEXT NOT NULL CHECK (json_valid(data_json)),
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    version INTEGER NOT NULL
      CHECK (typeof(version) = 'integer' AND version > 0),
    deleted_at TEXT,
    CHECK (
      length(occurred_at) = 24
      AND substr(occurred_at, 5, 1) = '-'
      AND substr(occurred_at, 8, 1) = '-'
      AND substr(occurred_at, 11, 1) = 'T'
      AND substr(occurred_at, 14, 1) = ':'
      AND substr(occurred_at, 17, 1) = ':'
      AND substr(occurred_at, 20, 1) = '.'
      AND substr(occurred_at, 24, 1) = 'Z'
      AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', occurred_at) = occurred_at, 0)
    ),
    CHECK (
      deleted_at IS NULL
      OR (
        length(deleted_at) = 24
        AND substr(deleted_at, 5, 1) = '-'
        AND substr(deleted_at, 8, 1) = '-'
        AND substr(deleted_at, 11, 1) = 'T'
        AND substr(deleted_at, 14, 1) = ':'
        AND substr(deleted_at, 17, 1) = ':'
        AND substr(deleted_at, 20, 1) = '.'
        AND substr(deleted_at, 24, 1) = 'Z'
        AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) = deleted_at, 0)
      )
    ),
    CHECK (deleted_at IS NULL OR deleted_at >= occurred_at),
    CHECK (
      COALESCE(
        (
          kind = 'diaper'
          AND json_type(data_json) = 'object'
          AND json_type(data_json, '$.diaperType') = 'text'
          AND json_extract(data_json, '$.diaperType') IN ('dry', 'wet', 'dirty', 'mixed')
        ) OR (
          kind = 'medicine'
          AND json_type(data_json) = 'object'
          AND json_type(data_json, '$.note') = 'text'
          AND length(
            trim(json_extract(data_json, '$.note'), char(9) || char(10) || char(13) || ' ')
          ) > 0
        ),
        0
      )
    )
  );

  CREATE INDEX visible_care_events_chronology
    ON care_events (child_id, occurred_at DESC, id DESC)
    WHERE deleted_at IS NULL;
`;

const CREATE_NURSING_SCHEMA = `
  CREATE TABLE nursing_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    child_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed')),
    left_duration_seconds INTEGER NOT NULL
      CHECK (typeof(left_duration_seconds) = 'integer' AND left_duration_seconds >= 0),
    right_duration_seconds INTEGER NOT NULL
      CHECK (typeof(right_duration_seconds) = 'integer' AND right_duration_seconds >= 0),
    total_pause_duration_seconds INTEGER NOT NULL
      CHECK (typeof(total_pause_duration_seconds) = 'integer' AND total_pause_duration_seconds >= 0),
    active_side TEXT CHECK (active_side IN ('left', 'right')),
    active_side_started_at TEXT,
    pause_started_at TEXT,
    last_breast_used TEXT NOT NULL CHECK (last_breast_used IN ('left', 'right')),
    timezone TEXT NOT NULL,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    version INTEGER NOT NULL
      CHECK (typeof(version) = 'integer' AND version > 0),
    deleted_at TEXT,
    CHECK (
      length(started_at) = 24 AND substr(started_at, 20) = '.000Z'
      AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', started_at) = started_at, 0)
    ),
    CHECK (
      ended_at IS NULL
      OR (
        length(ended_at) = 24 AND substr(ended_at, 20) = '.000Z'
        AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', ended_at) = ended_at, 0)
      )
    ),
    CHECK (
      active_side_started_at IS NULL
      OR (
        length(active_side_started_at) = 24 AND substr(active_side_started_at, 20) = '.000Z'
        AND COALESCE(
          strftime('%Y-%m-%dT%H:%M:%fZ', active_side_started_at) = active_side_started_at,
          0
        )
      )
    ),
    CHECK (
      pause_started_at IS NULL
      OR (
        length(pause_started_at) = 24 AND substr(pause_started_at, 20) = '.000Z'
        AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', pause_started_at) = pause_started_at, 0)
      )
    ),
    CHECK (
      deleted_at IS NULL
      OR (
        length(deleted_at) = 24 AND substr(deleted_at, 20) = '.000Z'
        AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) = deleted_at, 0)
      )
    ),
    CHECK (ended_at IS NULL OR unixepoch(ended_at) >= unixepoch(started_at)),
    CHECK (
      active_side_started_at IS NULL
      OR unixepoch(active_side_started_at) >= unixepoch(started_at)
    ),
    CHECK (
      pause_started_at IS NULL
      OR unixepoch(pause_started_at) >= unixepoch(started_at)
    ),
    CHECK (status != 'active' OR active_side = last_breast_used),
    CHECK (
      (
        status = 'active' AND ended_at IS NULL AND active_side IS NOT NULL
        AND active_side_started_at IS NOT NULL AND pause_started_at IS NULL
      ) OR (
        status = 'paused' AND ended_at IS NULL AND active_side IS NULL
        AND active_side_started_at IS NULL AND pause_started_at IS NOT NULL
      ) OR (
        status = 'completed' AND ended_at IS NOT NULL AND active_side IS NULL
        AND active_side_started_at IS NULL AND pause_started_at IS NULL
      )
    ),
    CHECK (
      status != 'active'
      OR left_duration_seconds + right_duration_seconds + total_pause_duration_seconds
        = unixepoch(active_side_started_at) - unixepoch(started_at)
    ),
    CHECK (
      status != 'paused'
      OR left_duration_seconds + right_duration_seconds + total_pause_duration_seconds
        = unixepoch(pause_started_at) - unixepoch(started_at)
    ),
    CHECK (
      status != 'completed'
      OR left_duration_seconds + right_duration_seconds + total_pause_duration_seconds
        = unixepoch(ended_at) - unixepoch(started_at)
    )
  );

  CREATE UNIQUE INDEX one_open_nursing_per_child
    ON nursing_sessions (child_id)
    WHERE status IN ('active', 'paused') AND deleted_at IS NULL;

  CREATE INDEX completed_nursing_chronology
    ON nursing_sessions (child_id, ended_at DESC, started_at DESC, id DESC)
    WHERE status = 'completed' AND deleted_at IS NULL;
`;

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

        CREATE UNIQUE INDEX one_open_phase_per_session
          ON sleep_phases (sleep_session_id)
          WHERE ended_at IS NULL AND deleted_at IS NULL;

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

        ${CREATE_NURSING_SCHEMA}

        ${CREATE_CARE_EVENTS_SCHEMA}

        PRAGMA user_version = ${DATABASE_VERSION};
      `);
    });
    return;
  }

  if (currentVersion === 1) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(`
        CREATE UNIQUE INDEX one_open_phase_per_session
          ON sleep_phases (sleep_session_id)
          WHERE ended_at IS NULL AND deleted_at IS NULL;

        ${CREATE_NURSING_SCHEMA}

        ${CREATE_CARE_EVENTS_SCHEMA}

        PRAGMA user_version = ${DATABASE_VERSION};
      `);
    });
    return;
  }

  if (currentVersion === 2) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(`
        ${CREATE_NURSING_SCHEMA}

        ${CREATE_CARE_EVENTS_SCHEMA}

        PRAGMA user_version = ${DATABASE_VERSION};
      `);
    });
    return;
  }

  if (currentVersion === 3) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(`
        ${CREATE_CARE_EVENTS_SCHEMA}

        PRAGMA user_version = ${DATABASE_VERSION};
      `);
    });
  }
}
