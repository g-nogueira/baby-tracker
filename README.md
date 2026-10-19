# Baby Tracker

A private baby-care tracker for Android and iPhone. Phase one now uses Napper as the
authoritative store through a thin mobile client. The first slice covers account login,
shared Nursing history, live Nursing controls, and completed-feed edits.

The original local-first tracker remains accessible under **On-device records** (`/local`).
Its SQLite database and outbox are isolated from Napper; existing records are not uploaded.
See [ADR 0004](docs/adr/0004-napper-client-phase-one.md) for scope, observed API contracts,
limitations, and the required live/phone acceptance checks.

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
npm run start
```

`npm run start` (or `pnpm start` / `pnpm mobile`) opens Expo's Android device chooser,
builds and installs the native app on the selected device, then starts Metro. It also works
from `apps/mobile`. Local Android builds require the Android SDK and a compatible JDK;
connect a phone with USB debugging enabled and authorize the computer, or configure an
Android emulator. Use `adb devices -l` to check connected devices.

For Metro only, use `npm run start:metro`; this skips the native build and installation.

Use an Expo development build for real-device work. Expo Go is not a release target.
Rebuild native development clients after installing the new SecureStore, Gesture Handler,
Reanimated, TrueSheet 3.11.12, and slider dependencies. Android/iOS JavaScript export validation
does not prove native installation, API compatibility, or gesture behavior on a phone.

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
