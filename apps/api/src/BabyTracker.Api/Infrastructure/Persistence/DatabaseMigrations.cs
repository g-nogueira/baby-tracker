namespace BabyTracker.Api.Infrastructure.Persistence;

internal static class DatabaseMigrations
{
    internal const long LatestVersion = 202608080001;

    internal static readonly IReadOnlyList<DatabaseMigration> All =
    [
        new(LatestVersion, "Initial sync schema", InitialSchema)
    ];

    private const string InitialSchema = """
        CREATE TABLE households (
            id uuid PRIMARY KEY,
            name text NOT NULL,
            created_at timestamptz NOT NULL
        );

        CREATE TABLE caregivers (
            id uuid PRIMARY KEY,
            household_id uuid NOT NULL REFERENCES households(id),
            display_name text NOT NULL,
            created_at timestamptz NOT NULL,
            revoked_at timestamptz
        );

        CREATE TABLE devices (
            id uuid PRIMARY KEY,
            caregiver_id uuid NOT NULL REFERENCES caregivers(id),
            name text NOT NULL,
            platform text NOT NULL CHECK (platform IN ('android', 'ios')),
            credential_hash bytea NOT NULL,
            last_seen_at timestamptz,
            revoked_at timestamptz
        );

        CREATE UNIQUE INDEX devices_credential_hash_unique ON devices (credential_hash);

        CREATE TABLE children (
            id uuid PRIMARY KEY,
            household_id uuid NOT NULL REFERENCES households(id),
            display_name text NOT NULL,
            timezone text NOT NULL,
            created_at timestamptz NOT NULL
        );

        CREATE TABLE sleep_sessions (
            id uuid PRIMARY KEY,
            child_id uuid NOT NULL REFERENCES children(id),
            kind text NOT NULL CHECK (kind IN ('nap', 'night')),
            started_at timestamptz NOT NULL,
            ended_at timestamptz,
            status text NOT NULL CHECK (status IN ('active', 'completed')),
            origin_timezone text NOT NULL,
            created_by uuid NOT NULL REFERENCES caregivers(id),
            updated_by uuid NOT NULL REFERENCES caregivers(id),
            version integer NOT NULL CHECK (version > 0),
            deleted_at timestamptz,
            CONSTRAINT sleep_session_valid_interval CHECK (ended_at IS NULL OR ended_at >= started_at),
            CONSTRAINT sleep_session_status_consistent CHECK (
                (status = 'active' AND ended_at IS NULL) OR
                (status = 'completed' AND ended_at IS NOT NULL)
            )
        );

        CREATE UNIQUE INDEX one_active_sleep_session_per_child
            ON sleep_sessions (child_id)
            WHERE status = 'active' AND deleted_at IS NULL;

        CREATE INDEX sleep_sessions_child_started_at
            ON sleep_sessions (child_id, started_at DESC);

        CREATE TABLE sleep_phases (
            id uuid PRIMARY KEY,
            sleep_session_id uuid NOT NULL REFERENCES sleep_sessions(id),
            kind text NOT NULL CHECK (kind IN ('asleep', 'awake')),
            started_at timestamptz NOT NULL,
            ended_at timestamptz,
            created_by uuid NOT NULL REFERENCES caregivers(id),
            updated_by uuid NOT NULL REFERENCES caregivers(id),
            version integer NOT NULL CHECK (version > 0),
            deleted_at timestamptz,
            CONSTRAINT sleep_phase_valid_interval CHECK (ended_at IS NULL OR ended_at >= started_at)
        );

        CREATE UNIQUE INDEX one_open_sleep_phase_per_session
            ON sleep_phases (sleep_session_id)
            WHERE ended_at IS NULL AND deleted_at IS NULL;

        CREATE INDEX sleep_phases_session_started_at
            ON sleep_phases (sleep_session_id, started_at);

        CREATE TABLE nursing_sessions (
            id uuid PRIMARY KEY,
            child_id uuid NOT NULL REFERENCES children(id),
            started_at timestamptz NOT NULL,
            ended_at timestamptz,
            status text NOT NULL CHECK (status IN ('active', 'paused', 'completed')),
            origin_timezone text NOT NULL,
            created_by uuid NOT NULL REFERENCES caregivers(id),
            updated_by uuid NOT NULL REFERENCES caregivers(id),
            version integer NOT NULL CHECK (version > 0),
            deleted_at timestamptz,
            CONSTRAINT nursing_session_valid_interval CHECK (ended_at IS NULL OR ended_at >= started_at)
        );

        CREATE UNIQUE INDEX one_active_nursing_session_per_child
            ON nursing_sessions (child_id)
            WHERE status IN ('active', 'paused') AND deleted_at IS NULL;

        CREATE TABLE nursing_segments (
            id uuid PRIMARY KEY,
            nursing_session_id uuid NOT NULL REFERENCES nursing_sessions(id),
            side text NOT NULL CHECK (side IN ('left', 'right')),
            started_at timestamptz NOT NULL,
            ended_at timestamptz,
            version integer NOT NULL CHECK (version > 0),
            deleted_at timestamptz,
            CONSTRAINT nursing_segment_valid_interval CHECK (ended_at IS NULL OR ended_at >= started_at)
        );

        CREATE UNIQUE INDEX one_open_nursing_segment_per_session
            ON nursing_segments (nursing_session_id)
            WHERE ended_at IS NULL AND deleted_at IS NULL;

        CREATE TABLE care_events (
            id uuid PRIMARY KEY,
            child_id uuid NOT NULL REFERENCES children(id),
            kind text NOT NULL CHECK (kind IN ('diaper', 'medicine', 'bath')),
            occurred_at timestamptz NOT NULL,
            origin_timezone text NOT NULL,
            data jsonb NOT NULL,
            created_by uuid NOT NULL REFERENCES caregivers(id),
            updated_by uuid NOT NULL REFERENCES caregivers(id),
            version integer NOT NULL CHECK (version > 0),
            deleted_at timestamptz
        );

        CREATE INDEX care_events_child_occurred_at
            ON care_events (child_id, occurred_at DESC);

        CREATE TABLE applied_operations (
            operation_id uuid PRIMARY KEY,
            household_id uuid NOT NULL REFERENCES households(id),
            device_id uuid NOT NULL REFERENCES devices(id),
            entity_id uuid NOT NULL,
            entity_type text NOT NULL,
            action text NOT NULL,
            result jsonb NOT NULL,
            client_occurred_at timestamptz NOT NULL,
            client_timezone text NOT NULL,
            server_received_at timestamptz NOT NULL
        );

        CREATE TABLE household_changes (
            sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            household_id uuid NOT NULL REFERENCES households(id),
            entity_id uuid NOT NULL,
            entity_type text NOT NULL,
            version integer NOT NULL,
            payload jsonb NOT NULL,
            changed_at timestamptz NOT NULL
        );

        CREATE INDEX household_changes_incremental_pull
            ON household_changes (household_id, sequence);

        CREATE TABLE home_assistant_outbox (
            id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            household_id uuid NOT NULL REFERENCES households(id),
            operation_id uuid NOT NULL REFERENCES applied_operations(operation_id),
            topic text NOT NULL,
            payload jsonb NOT NULL,
            retain boolean NOT NULL,
            state_version bigint NOT NULL,
            attempts integer NOT NULL DEFAULT 0,
            next_attempt_at timestamptz NOT NULL,
            published_at timestamptz
        );

        CREATE INDEX home_assistant_outbox_pending
            ON home_assistant_outbox (next_attempt_at, id)
            WHERE published_at IS NULL;
        """;
}

internal sealed record DatabaseMigration(long Version, string Name, string Sql);
