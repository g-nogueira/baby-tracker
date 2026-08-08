# ADR 0002: Start with a modular monolith

Status: Accepted  
Date: 2026-08-08

## Context

The private deployment serves one household and two devices. Strong consistency is required
between canonical care state, the change feed, applied operation IDs, and the Home Assistant
outbox.

## Decision

Use one ASP.NET Core service and one PostgreSQL database. Keep feature and infrastructure
boundaries explicit inside the service, but commit a sync operation, change-feed entry, and Home
Assistant outbox entry in one database transaction.

PostgreSQL migrations run in-process under a session-level advisory lock. The schema uses database
constraints for invariants that can be enforced without aggregate history.

## Consequences

- Deployment and recovery stay small enough for a home server.
- Cross-boundary consistency does not need a distributed transaction.
- MQTT publishing remains asynchronous through the durable database outbox.
- A module can be extracted later if load or ownership—not aesthetics—requires it.
