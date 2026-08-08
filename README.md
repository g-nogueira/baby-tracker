# Baby Tracker

A private, local-first baby-care tracker for Android and iPhone, with shared synchronization
and downstream Home Assistant automation.

The repository is under active development. The first vertical slice records naps locally and
persists an outbox operation in the same SQLite transaction.

## Stack

- Expo SDK 57, React Native 0.86, React 19, and TypeScript 6
- Expo Router and Expo SQLite
- ASP.NET Core on .NET 10 LTS
- PostgreSQL 18
- pnpm workspaces, Biome, Vitest, and GitHub Actions

## Repository layout

```text
apps/mobile       Expo app and local SQLite adapter
apps/api          ASP.NET Core API and PostgreSQL persistence
packages/domain   Framework-free care and sync domain
docs              Product specification and architecture decisions
infra             Local Docker Compose environment
```

## Mobile development

Prerequisites: Node.js 24+ and pnpm 11.20+.

```bash
pnpm install
pnpm check
pnpm mobile
```

Use an Expo development build for real-device work. Expo Go is not a release target.

## API development

Prerequisites: .NET SDK 10 and Docker with Compose.

```bash
docker compose -f infra/compose.yaml up -d postgres
dotnet restore BabyTracker.slnx
dotnet run --project apps/api/src/BabyTracker.Api
```

The API exposes liveness at `/health/live`, readiness at `/health/ready`, and OpenAPI in
development at `/openapi/v1.json`.

## Security note

The API is not ready for internet exposure until device pairing and credential authentication
are implemented. PostgreSQL is bound to localhost in the development Compose file.
