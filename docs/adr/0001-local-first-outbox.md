# ADR 0001: Local-first writes with a transactional outbox

Status: Accepted  
Date: 2026-08-08

## Context

Caregivers must be able to record an activity immediately even when the private API, tunnel, or
internet is unavailable. The same operation may be retried after uncertain network outcomes.

## Decision

SQLite is the mobile UI's source of truth. Every local mutation updates the read model and appends
an immutable UUIDv7 operation to the local outbox in one transaction. Synchronization submits
operations in creation order. The API records every applied operation ID and returns its original
result when retried.

The UI never calls HTTP directly. It uses application operations backed by a local repository;
the future sync worker is another consumer of that repository.

## Consequences

- App and network availability are decoupled.
- Active timers survive process death because duration derives from persisted timestamps.
- Local schema migrations and outbox compatibility become release-critical.
- Conflict handling must retain the local proposal until the caregiver resolves it.
