# ADR 0004: Use Napper as the phase-one authoritative store

The initial Nursing slice described here is extended by [ADR 0005](0005-shared-care-service.md):
provider-neutral service/session ports and the connected Day/Night care home.

Status: accepted direction; first Nursing slice implemented, awaiting live/phone acceptance
Date: 2026-10-13

## Decision

For phase one, ship a thin private client of Napper rather than finish the standalone sync
backend first. Prioritize familiar, simple interactions and a working shared account. The mobile
root opens this client; `/local` still opens the existing SQLite tracker with its original database
and outbox. No migration, replay, or implicit upload of on-device records occurs.

The application boundary is `features/napper/NapperTracker`; HTTP and wire contracts live in
`NapperClient`. Napper is authoritative. A successful action requires a confirmed remote reread.
No offline write queue is created. Reads refresh on foreground, every 30 seconds, and on demand.
Time derives from instants and pause intervals, not timer ticks. Tokens and the installation ID
use Expo SecureStore; the token pair is stored together. Sign-out clears credentials and views.

## First slice

- Email OTP login, profile discovery/selection, and session restoration/token rotation.
- Shared Nursing history by calendar date, with a read-only radial projection.
- Start on either breast, choose a past start time, switch, pause/resume, and stop.
- Edit a completed feed's start/end, left/right split, and explicit last breast used.
- Native bottom sheet and slider; stable native picker draft; elapsed time in collapsed controls,
  timestamps when expanded. Persistent running-feed controls remain available in history.

The Nursing drawer uses stock `@lodev09/react-native-true-sheet` 3.11.12 (updated 2026-10-14),
replacing Gorhom. Napper's captured dependency manifest names this version with a Yarn patch.
The supplied Android Smali archive was compared with the published npm source: the inspected
direction locking, nested scrolling, grabber and touch dispatch paths match upstream behavior.
No Android-specific patch was identified in those paths; this is not proof of complete binary
equivalence and says nothing about an iOS patch. Do not copy the supplied native binary or
decompiled files into the app. Initial presentation, resizing, scrolling and dismissal use the
library's native lifecycle; the proposed-time picker waits for expansion to finish. Heights
remain app-specific, pending phone comparison with Napper.

This is a Nursing-only slice, not the complete Napper UI or phase-one MVP. Day/Night sleep
transitions, wake-up edits, nap continuation, past activity creation, diaper/medicine writes,
weekly history, and full dial parity remain future slices. Original local features are accessible
separately. Active-feed start/split corrections are also deferred; completed correction ships first.

## Observed contract

Derived from the user-provided `napper.js` SDK/source capture and the existing backup exporter.
This is an observed private contract, not an official supported API guarantee. The source capture,
real credentials, and private account data are not committed. Tests use synthetic fixtures only.

| Operation | Observed route / representation |
| --- | --- |
| Send code | `POST /auth/send-otp`, email, `useDeviceId:false`, source/language |
| Login | `POST /auth/email-login`, email, OTP, `useDeviceId:false` |
| Rotate tokens | `POST /auth/refresh-token`, ID and refresh token together |
| Profiles | `GET /babies`, filter `type:BABY` |
| Shared current state | `GET /today/{babyId}/{offsetTimestamp}`, supplemented with yesterday's logs |
| Day history | `GET /logs-by-day/{babyId}/{YYYY-MM-DD}` |
| Nursing write | `PUT /logs/{babyId}`, the SDK-whitelisted log object directly |

Headers include the observed APP source, version 6.71.0, device installation ID, language,
locale, offset-bearing Local-Timestamp, and bearer ID token. New IDs use `LOG_{uuid}_NURSING`.
The fields named `breastLeftMinutes` and `breastRightMinutes` contain **seconds**. The pause
editor's `updatePause`/`removePause` arithmetic divides millisecond intervals by 1000, so these
fields can contain fractional seconds. Retain the inactive side's exact stored value; match
the SDK by rounding the active side only after subtracting pauses and the inactive duration.
`activeBreast` is the last breast used and is preserved on stop; it is not inferred from totals.
Pauses are `{breast, start:epochMilliseconds, end:epochMilliseconds|null}`. Stopping while paused
ends at the open pause's start and removes that trailing pause, matching the captured SDK.
Resuming a completed feed in Napper reopens the same ID, resets End to Start, and appends a
closed pause from the former End to the resume instant. Refresh must replace the stopped
read model and restore live controls without counting that gap. Synthetic HTTP and screen
regressions cover this transition and subsequent pause/resume/stop writes. A user's generic
read-failure screenshot does not establish which field failed; unsupported running records
now show a fixed validation explanation without including wire values or response bodies.
Existing writable metadata is retained; no comment decoding/re-encoding or editing is introduced.
Today returns `item.logs`; the SDK's day-history reader uses `item.allLogs`. The parser accepts
these observed envelopes and rejects missing/unsupported arrays and `success:false` responses.

## Save and conflict behavior

A local lock blocks overlapping taps. Existing-record mutations reread and compare the full
record fingerprint first. A remote change detected before PUT fails visibly. After PUT the client
rereads and verifies the expected Nursing fields. Timeouts, 5xx responses, and unconfirmed rereads
block further changes until the user refreshes; no ambiguous write is automatically retried.
A definite authentication rejection can rotate tokens and retry once.

No server compare-and-swap/version contract was observed. A caregiver can still change the
record between the preflight GET and PUT; preflight checks cannot eliminate that race. This
limitation must be tested and resolved before claiming robust concurrent-edit guarantees.
Current-state reads cover today and yesterday; an abnormally long feed starting earlier is not
covered. Historical screens follow calendar days for this first slice, not Napper's complete
Wake-up-to-Bedtime/Night cycle model.

Offset-bearing wire timestamps are converted to canonical UTC only at the radial projection
boundary. The original shared record remains unchanged for fingerprint checks and writes.
Unsupported closed history records stay read-only without disabling a valid running feed;
unsupported running records, unknown running states and multiple active feeds still block writes.
The separate on-device tracker carries a persistent source notice and a return-to-Napper action.

## Acceptance and validation

Automated tests exercise synthetic HTTP contracts, secure-store boundary failures, restart,
token refresh races, stale changes, double taps, uncertain writes, pause math, cross-midnight
corrections, picker stability and slider callbacks. Android/iOS Expo exports validate bundling.
Exports are not installed native builds; component boundary mocks cannot validate real gestures.
No live account login or write is performed during development.

Before accepting this slice on phones:

1. Make a separate test profile in Napper. Confirm the current OTP/refresh/read contract first.
2. Run a development build on Android and iPhone (new native modules require rebuilding).
3. On synthetic records, start, switch, pause, restart, resume, stop, edit and confirm in Napper.
4. Check handle dragging, scrolling, modal dismissal, continuous slider response and picker
   stability during ticking. Confirm the collapsed/expanded layouts on both phone sizes.
5. Use both caregivers to change a test feed; check visible stale-edit handling and characterize
   the unavoidable preflight race. Check disconnected and lost-ack recovery without duplication.
6. Confirm on-device records remain available and never upload to Napper implicitly.

Expand to sleep and other activity writes after this vertical slice passes those checks.
