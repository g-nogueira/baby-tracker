# ADR 0005: Shared care operations behind replaceable service ports

Status: Accepted for phase one, extending [ADR 0004](0004-napper-client-phase-one.md).

## Problem and decision

The Nursing-only connected screen and the separate local Day/Night screen used different
stores. Navigating between them made a successful Napper login look like an import that
did not affect the home screen. The connected home now reads and writes shared care records
through provider-neutral ports; Napper is the initial adapter, not the UI's data model.

`features/care-service/contracts.ts` defines `CareService`, `CareSession`, typed care commands,
canonical activities and fixed read issues. The application composition root is
`composition/care-provider.ts`, injected into `CareScreen` by the root route. It is the one
place to replace Napper with our own service. No production fake provider is shipped.

The UI/hook does not import Napper contracts, clients, wire logs, HTTP, SQLite or credentials.
The separate SQLite tracker remains under `/local`; its data/outbox is not uploaded implicitly.

## Read model and mutation boundary

- Activity timestamps are canonical UTC. IDs and revisions are opaque strings, never parsed
  by the UI. Provider metadata and full record fingerprints stay inside the adapter.
- Nursing exposes accumulated L/R totals measured at an instant plus total pause seconds.
  Running clocks extrapolate from that measurement. Exact pause intervals remain inside
  the provider, so our existing Nursing aggregate can implement the port without fabricating
  historical pauses. Sleep exposes an aggregate pause duration measured at an instant too;
  its paused clock stays frozen between reads without exposing transport pause arrays.
- The factory receives the selected IANA zone for new writes. A provider can expose an
  activity's `originTimezone` for historical editing. Napper supplies only offset timestamps;
  its original IANA zone is unknown and is not guessed. Its adapter translates the selected
  zone into the offset-bearing timestamps required by the observed SDK.
- Confirmed removal is an explicit `remove-activity` command carrying an opaque activity revision.
  The UI confirms intent; the provider rejects stale records and confirms authoritative absence.
  The initial adapter supports individual Nap, Night waking, Nursing, Diaper and Medicine removal;
  night boundaries are not deleted independently and no implicit cascade or fake Undo is offered.
- Commands express care operations: start/pause/switch/stop Nursing, start/pause/resume/stop/continue Nap,
  bedtime, night waking, fall asleep, morning wake-up, edits and past activity creation.
  Auth and care ports are separate, so changing authentication does not affect activity code.
- `execute` resolves only after an authoritative reread confirms the save. The hook never
  treats optimistic screen state as saved. If the additional screen read fails after a
  confirmed save, the draft closes as saved and further submissions require refresh.
- An open editor retains its reviewed revision. Polling cannot silently advance an edit's
  concurrency token. A changed or expired revision fails visibly instead of overwriting.

`NapperCareService` retains bounded private revision snapshots and delegates transport/locking
to `NapperTracker`/`NapperClient`. Clearing or changing the session invalidates snapshots;
late reads cannot repopulate a cleared session. Synthetic tests run the generic hook with a
different provider, with HTTP disabled, to verify the substitution boundary.

## Observed Napper sleep and care contract

Derived from the supplied SDK capture, not from calls to the family's live account:

| Care operation | Observed representation |
| --- | --- |
| Bedtime | Closed `BED_TIME` point; evening starts use a preceding-midnight anchor and `startMinutesAfterMidnight` |
| Morning wake-up | Closed `WOKE_UP` point |
| Nap | `NAP` interval with `isOpen` and optional pause intervals |
| Night waking / fell asleep | Open / closed `NIGHT_WAKING` interval |
| Pause / resume a Nap | Append a final open pause / close that pause on the same open record |
| Stop a paused Nap | End at the open pause start and remove that final pause |
| Continue a stopped Nap | Same record reopened, stopped gap appended as a pause; SDK's one-hour resume limit |
| Diaper | `CHANGED_DIAPER`, `diaperContent` in `DRY/WET/DIRTY/MIXED` |
| Medicine | `MEDICINE`, URI-encoded unrestricted comment; no dose validation or advice |
| Writes | Existing direct `PUT /logs/{babyId}` SDK whitelist; no invented batch endpoint |

The adapter decodes bedtime's minute anchor before projecting real Bedtime → Wake-up bounds.
It preserves existing writable ownership, comments and care metadata. Offset serialization,
bedtime decoding and calendar-day retrieval cover midnight and Lisbon DST transitions.
Neighboring storage dates are read because an evening bedtime may be stored on the preceding
date. Duplicate windows share reads and independent reads run concurrently.

Napper has separate records for the night boundaries and each waking. Sleep writes validate
boundary alternation, ordering, containing nights, pauses and overlaps before sending. A bounded
read may begin with a night waking whose bedtime is outside the window. Validation compares the
before/after timeline: newly introduced conflicts and conflicts involving edited records are
rejected; unchanged unrelated history does not prevent an afternoon Nap. Ambiguous live state
still blocks writes. A final open pause is valid only on an open sleep record; overlapping,
non-final, future or out-of-bounds pauses remain invalid. Nursing can run concurrently with sleep; duplicate/ambiguous live state remains blocked. Unknown
records remain read-only with fixed explanations that contain no raw response data.

Morning wake-up during an active waking needs two ordered PUTs: close that waking, then add
`WOKE_UP`. The first closure is reread and confirmed before the dependent boundary PUT. The
remaining command is replanned against that fresh window, retaining its originally allocated
IDs and reviewed bedtime revision. A changed bedtime, another waking, or an unconfirmed first
save stops the transition before creating Wake up. After the final write, requested fields and
the resulting sleep timeline are both verified, including newly introduced remote collisions.
No atomic batch or conditional-write contract was observed. If a later step or confirmation
fails, accepted records are retained, the transition is marked uncertain and another write is
blocked until manual refresh/review. No blind retry or compensating delete
is attempted. Another caregiver can still write between preflight GET and PUT; this adapter
cannot provide the server-side CAS/atomicity that our own service should implement. A stale
Napper client can still overwrite records after confirmation; no client-only guard can prevent
that remote write. Refresh exposes known sleep collisions as fixed read issues, including a
closed night waking crossing morning Wake up. The UI displays those reasons and leaves completed
records editable for an explicit correction; it does not silently shorten or remove real data.
Nursing remains independent of sleep collision checks. A missing bedtime alone at the left edge
of a bounded history is not presented as a confirmed collision.

## Connected home behavior

Day/Night selectors, exact anchor/record editing, midnight ticks, fitted completed Nights,
provisional active Nights and dense-marker selection reuse the existing projection primitives.
Night sleep is the containing phase and has no separate bottom stop timer. Nap or Night waking
and Nursing can have concurrent persistent controllers. Wake up and Fell asleep again are
distinct operations. The home actions use icons and recency text.

Proposed start/transition times are tappable. Native TrueSheet owns detents and dismissal;
native slider updates arrive during dragging. Date/time pickers hold unconfirmed selections
through clock renders. Active Nursing start editing captures its original reviewed revision;
completed Nursing retains explicit Last and whole-second split editing. Past activity creation
uses the selected historical cycle, including past nights. History has a calendar strip, cycle/list views and recorded totals. Predictions and full Napper
analytics remain outside this delivery.

## Portable activity annotations

`ActivityDetails` adds optional settling flags, sleep method, wake mood and comment to the read model.
Creation, transition, edit and past-record commands carry sparse detail patches alongside timestamps.
The UI uses neutral values such as `held` and `took-long`; Napper strings stay in `care-details.ts`.

| Care field | Observed Napper field | Examples |
| --- | --- | --- |
| `settling` | `babyMoodOnSleep` | `took-long` → `LONG_TIME_TO_FALL_ASLEEP`, `upset` → `UPSET` |
| `sleepMethod` | `howBabySlept` | `in-bed` → `IN_BED`, `held` → `WORN_OR_HELD` |
| `wakeMood` | `babyMoodOnWakeUp` | `bad` / `neutral` / `good` → `BAD` / `NEUTRAL` / `GOOD` |
| `comment` | `comment` | URI-encoded only inside the adapter |

Only edited keys are replaced; other permitted Napper fields and unknown enum values are preserved.
Annotations use the same reviewed revision and authoritative confirmation as time edits. During a
morning transition, mood/comment target the new Wake-up record; they do not overwrite the waking
record that must first be closed. A replacement service stores the neutral values directly.

## Replacing Napper with our service

Implement `CareSession` and `CareService` against our API, map its aggregate read models to
`CareSnapshot`, and return them from `createCareProvider(timezone)`. Keep revisions opaque;
use our server's version/ETag for conditional writes and a transaction for multi-record sleep
transitions. Persist UTC instants with their originating IANA timezone. The UI, drawers,
home projections, polling, command types and separate local tracker need no transport rewrite.
Migration/backfill of existing Napper records is a separate explicit operation, not a login side effect.

## Validation and remaining acceptance

Synthetic HTTP tests cover complete nights, concurrent Nursing, both kinds of waking completion,
reopened and paused naps, frozen paused clocks, stopping during a pause, time edits, truncated
night history, neighboring-boundary conflicts, unknown state, stale/forged revisions, double taps
and partial transitions. Regression fixtures cover acknowledged-but-unconfirmed closures,
changes between the two morning writes, remote collisions introduced after the final PUT, and
explicit correction of a closed waking that crosses Wake up without changing concurrent Nursing.
Hook tests verify provider substitution, midnight rollover and confirmed-save/read
failure handling. Native-boundary tests cover stable pickers, proposed times, continuous sliders,
explicit Last, active-start revisions and dismissal without an implicit write.

Android/iOS JavaScript exports check bundling, not installed native behavior. Acceptance still
requires a test profile on both phones: run bedtime → night waking → fell asleep → morning wake-up,
with concurrent Nursing; confirm changes in Napper and in the other phone. Also edit a morning
wake-up, log past-night care, pause/resume a nap in both apps, stop it while paused, and continue
an accidentally stopped nap. Night read synchronization has been reported working on a phone;
night writes have been reported working with a collision caveat. The new guarded transition and
collision warning/correction flow still require phone acceptance. Existing native dependencies
are unchanged; this delivery does not require adding another native module.

The connected presentation refresh and its static-review limits are documented in [the UI refresh notes](../design/napper-inspired/ui-refresh.md).

## Sleep interval editing

Sleep snapshots expose portable pause intervals with references scoped to the reviewed activity
revision. The dial shows the current uninterrupted sleep/awake stretch; accumulated sleep in the
live controller still excludes every pause. Aggregate-only providers retain the existing clock.
`edit-sleep` replaces a reviewed interval and pause list through the care port. The Napper adapter
retains metadata for referenced pauses, validates ordering/ranges, and uses the existing preflight
and readback checks. An explicit end closes a running interval; reopening remains Continue Nap.
The existing Stop-while-paused rule is preserved. Synthetic protocol tests cover these operations;
manual pause editing against a live test account still requires device validation.
