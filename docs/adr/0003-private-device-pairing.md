# ADR 0003: Private device credentials and QR pairing

Status: Accepted  
Date: 2026-08-08

## Context

The MVP has one household and two caregivers. Public account registration would add recovery,
email, password, abuse, and billing concerns without improving daily use.

## Decision

The deployment has a one-time bootstrap secret. Bootstrap creates the first household, caregiver,
and device; the API then returns a revocable high-entropy device credential. A paired caregiver
uses a short-lived, single-use invitation encoded in a QR code. Credential hashes—not raw
credentials—are stored by the API.

Until this flow and request authentication exist, the API must remain bound to localhost and must
not be exposed through the tunnel.

## Consequences

- Each phone can be revoked independently.
- Paloma does not need an email/password flow.
- A future public version will require a different identity architecture.
