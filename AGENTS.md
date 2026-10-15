# Repository guidance

## Product invariants

- The original on-device tracker is local-first: its writes commit to SQLite before sync.
- The phase-1 Napper client uses Napper as the authoritative store. Its online writes go through
  the Napper application adapter, never the local tracker/outbox. Keep these two modes isolated.
- Historical care data belongs to the tracker; Home Assistant only consumes canonical live state
  and transition events.
- Never log medicine text, credentials, pairing codes, or raw request bodies.
- Never silently resolve a genuine concurrency conflict with last-write-wins.
- Persist instants in UTC and retain the originating IANA timezone.

## Architecture

- Keep `packages/domain` framework-free and deterministic.
- UI code calls application/repository abstractions, never HTTP directly.
- A local mutation and its outbox operation are one database transaction.
- API features may depend on domain abstractions; domain code must not depend on EF Core,
  ASP.NET Core, Expo, or React Native.
- Prefer feature folders and cohesive modules over technical-layer sprawl.

## Quality gates

- Run `pnpm check` for TypeScript changes.
- Run `dotnet test BabyTracker.slnx` for .NET changes.
- Add tests for domain rules, sync idempotency, conflict behavior, and migrations.
- Do not expose placeholder endpoints that return fake success.
