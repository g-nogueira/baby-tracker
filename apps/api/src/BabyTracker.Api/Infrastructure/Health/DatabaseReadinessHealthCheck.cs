using BabyTracker.Api.Infrastructure.Persistence;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Npgsql;

namespace BabyTracker.Api.Infrastructure.Health;

internal sealed class DatabaseReadinessHealthCheck(NpgsqlDataSource dataSource) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        try
        {
            await using var command = dataSource.CreateCommand(
                "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)");
            command.Parameters.AddWithValue(DatabaseMigrations.LatestVersion);
            var ready = (bool?)await command.ExecuteScalarAsync(cancellationToken) ?? false;

            return ready
                ? HealthCheckResult.Healthy()
                : HealthCheckResult.Unhealthy("The latest database migration is not applied.");
        }
        catch (Exception exception) when (exception is NpgsqlException or InvalidOperationException)
        {
            return HealthCheckResult.Unhealthy("PostgreSQL is unavailable.", exception);
        }
    }
}
