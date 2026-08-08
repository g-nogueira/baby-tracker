using Npgsql;

namespace BabyTracker.Api.Infrastructure.Persistence;

internal sealed partial class DatabaseMigrationService(
    NpgsqlDataSource dataSource,
    ILogger<DatabaseMigrationService> logger) : IHostedService
{
    private const long AdvisoryLockKey = 2_928_292_203;

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var lockCommand = new NpgsqlCommand("SELECT pg_advisory_lock($1)", connection);
        lockCommand.Parameters.AddWithValue(AdvisoryLockKey);
        await lockCommand.ExecuteNonQueryAsync(cancellationToken);

        try
        {
            await EnsureHistoryTableAsync(connection, cancellationToken);
            var applied = await ReadAppliedVersionsAsync(connection, cancellationToken);

            foreach (var migration in DatabaseMigrations.All.Where(candidate => !applied.Contains(candidate.Version)))
            {
                ApplyingDatabaseMigration(logger, migration.Version, migration.Name);

                await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
                await using var migrationCommand = new NpgsqlCommand(migration.Sql, connection, transaction);
                await migrationCommand.ExecuteNonQueryAsync(cancellationToken);

                await using var historyCommand = new NpgsqlCommand(
                    "INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, now())",
                    connection,
                    transaction);
                historyCommand.Parameters.AddWithValue(migration.Version);
                historyCommand.Parameters.AddWithValue(migration.Name);
                await historyCommand.ExecuteNonQueryAsync(cancellationToken);

                await transaction.CommitAsync(cancellationToken);
            }
        }
        finally
        {
            await using var unlockCommand = new NpgsqlCommand("SELECT pg_advisory_unlock($1)", connection);
            unlockCommand.Parameters.AddWithValue(AdvisoryLockKey);
            await unlockCommand.ExecuteNonQueryAsync(CancellationToken.None);
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Information,
        Message = "Applying database migration {MigrationVersion} {MigrationName}")]
    private static partial void ApplyingDatabaseMigration(
        ILogger logger,
        long migrationVersion,
        string migrationName);

    private static async Task EnsureHistoryTableAsync(
        NpgsqlConnection connection,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version bigint PRIMARY KEY,
                name text NOT NULL,
                applied_at timestamptz NOT NULL
            )
            """, connection);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<HashSet<long>> ReadAppliedVersionsAsync(
        NpgsqlConnection connection,
        CancellationToken cancellationToken)
    {
        var versions = new HashSet<long>();
        await using var command = new NpgsqlCommand("SELECT version FROM schema_migrations", connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        while (await reader.ReadAsync(cancellationToken))
        {
            versions.Add(reader.GetInt64(0));
        }

        return versions;
    }
}
