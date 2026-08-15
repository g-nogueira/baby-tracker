# Baby Tracker — Napper-inspired UX implementation directive

Status: GitHub task update applied; ready for implementation  
Prepared: 2026-08-14, Europe/Lisbon  
Implementation branch parent: `Napper-inspired Baby Tracker - Dev`  
Design input branch: `BR-20260814-1320-baby-tracker-napper-ux`  
Implementation-direction branch: `BR-20260814-1451-baby-tracker-ux-implementation`

## 1. Purpose

This document converts the accepted Napper-inspired product design into implementation contracts for `g-nogueira/baby-tracker`. It is intended to let the origin Dev conversation update GitHub issues and delegate work without asking implementation agents to reverse-engineer the interactive HTML.

This revision records the GitHub task updates applied on 2026-08-14. It does not modify repository code or PR #10.

## 2. Source hierarchy

When sources disagree, use this order:

1. User-confirmed decisions in the design handoff.
2. This implementation directive.
3. `docs/product-spec.md` for unchanged product, sync, privacy, and Home Assistant rules.
4. `baby-tracker-record-editing-standalone.html` for interaction and visual direction.
5. `82812.mp4` for observed Napper behavior only.

The HTML is a behavioral mockup, not production code. Do not copy its in-memory data structures, hard-coded times, fixed 30-second pause, or browser-specific implementation.

## 3. Confirmed product decisions

The following are P0 and no longer open design questions:

- Home has separate **Day cycle** and **Night cycle** radial views.
- Day begins at the recorded Wake up instant; Night begins at the recorded Bedtime instant.
- An event icon marks the event start, never its end.
- A timed event extends clockwise from its icon by a length proportional to its duration.
- Tapping a radial icon edits that exact persisted record.
- Quick actions open a functional draggable bottom drawer.
- The collapsed drawer exposes one obvious primary action; advanced fields appear when expanded.
- Running actions remain visible through persistent live controllers.
- Normal Home actions are Night sleep, Nap, Nursing, Medicine, and Diaper.
- During an active night session, Wake up replaces Night sleep and Night waking replaces Nap.
- Nap, Night sleep, and Night waking have distinct domain semantics.
- Nursing starts by selecting Left or Right, shows Last and Next, tracks sides independently, and edits the total split with one slider.
- Next is always the opposite of the breast used most recently, but either side remains selectable.
- Diaper create and edit both support Dry, Wet, Dirty, and Mixed.
- Medicine remains timestamp plus unrestricted free text, without dose advice or validation.
- Prediction, overdue-nap warnings, medicine reminders, advanced statistics, and Napper import remain excluded.

## 4. Current implementation baseline

Verified against draft PR [#10](https://github.com/g-nogueira/baby-tracker/pull/10), head `dda26a5`, and the open issues on 2026-08-14.

### Preserve

- React Native/Expo single codebase.
- Local-first SQLite write followed by outbox enqueue in one transaction.
- UTC instants plus originating IANA timezone.
- Optimistic version protection and overlap validation.
- Nap start, stop, edit, delete, Undo, process-restart persistence, and DST-safe calendar-day queries.
- Existing draggable nap drawer as the first implementation of a reusable drawer primitive.
- Existing persistent active-nap controller and adaptive live clock.
- The normalized `sleep_sessions` and `sleep_phases` tables.
- The repository/application boundary; UI must not write SQLite or HTTP directly.

### Provisional and expected to change

- `NapRadialTimeline` is a nap-only 24-hour point-marker clock.
- Nap markers are non-interactive views and all editing routes through the generic Nap action.
- Completed naps have no visible duration arc.
- Home knows only the Nap action and one active timer.
- `NapSession` is a nap-specific type rather than a general sleep aggregate.
- `NapEditorSheet` is feature-specific instead of a shared drawer shell with activity content.
- `today-screen.tsx` combines navigation, projection, mutation orchestration, rows, drawer state, and live-controller state.

### Current issue inconsistency

Issue #3 says radial timeline implementation is out of scope, while PR #10 now contains and advertises a radial timeline. Resolve the issue text before merging so the acceptance contract matches what the PR actually ships.

## 5. Domain model and persistence contracts

### 5.1 Do not adopt the mockup's flat `ActivityRecord` persistence model

Keep aggregate-specific tables. “Distinct persisted types” means the database and domain must distinguish the operations semantically; it does not require every Home action to become a row in one flat table.

| User action | Canonical persistence |
| --- | --- |
| Nap | `SleepSession(kind=nap)` with exactly one `SleepPhase(kind=asleep)` |
| Night sleep / Bedtime | `SleepSession(kind=night)` plus first `SleepPhase(kind=asleep)` |
| Night waking | Close current asleep phase and append `SleepPhase(kind=awake)` in the active night session |
| Fell asleep again | Close current awake phase and append `SleepPhase(kind=asleep)` in the same night session |
| Wake up | Close the open phase and night session; the session end is the Day-cycle anchor |
| Nursing | `NursingSession` aggregate described below |
| Diaper / Medicine / Bath | `CareEvent` with a typed payload |

Bedtime and Wake up icons are projections of the night session start/end. Do not duplicate them as independent care-event rows.

### 5.2 Sleep aggregate

Generalize the domain type without breaking the existing nap invariant:

```ts
type SleepSessionKind = "nap" | "night";
type SleepPhaseKind = "asleep" | "awake";

interface SleepSession {
  id: string;
  childId: string;
  kind: SleepSessionKind;
  startedAt: UtcInstant;
  endedAt: UtcInstant | null;
  status: "active" | "completed";
  timezone: string;
  phases: readonly SleepPhase[];
  version: number;
  deletedAt: UtcInstant | null;
  // existing created/updated identity fields remain
}
```

Domain invariants:

- A child has at most one non-deleted active sleep session.
- A Nap has exactly one asleep phase and no awake phase.
- An active Night session has exactly one open phase.
- Night phases are ordered, alternate asleep/awake, and never overlap.
- Every completed session has an end and no open phase.
- A transition time must be after the open phase start and cannot be in the future beyond the existing clock-skew tolerance.
- Editing phase boundaries must preserve ordering and the session bounds.
- Sleep-session mutations and their outbox operations remain one local transaction.

### 5.3 Sync aggregate boundary

Keep `sleep_session` as the sync aggregate root. A night transition may update normalized `sleep_phases` rows locally, but the outbox operation targets the session and carries the transition or canonical aggregate payload.

Do not synchronize phases as independently versioned top-level entities in P0. Otherwise a partial pull can temporarily violate alternation and “one open phase.”

Required actions eventually include:

```ts
type SleepSyncAction =
  | "start_nap"
  | "stop_nap"
  | "start_night_sleep"
  | "start_night_waking"
  | "resume_night_sleep"
  | "end_night_sleep"
  | "edit_sleep_session"
  | "delete_sleep_session"
  | "restore_sleep_session";
```

Issue #6 remains nap-only for M1. Add night actions when M2 begins; do not prematurely broaden the server synchronization task before M1 convergence is proven.

### 5.4 Nursing aggregate — P0 simplification

For P0, use accumulated side totals plus explicit last-side state rather than requiring editable ordered segments:

```ts
interface NursingSession {
  id: string;
  childId: string;
  startedAt: UtcInstant;
  endedAt: UtcInstant | null;
  status: "active" | "paused" | "completed";
  leftDurationSeconds: number;
  rightDurationSeconds: number;
  totalPauseDurationSeconds: number;
  activeSide: "left" | "right" | null;
  activeSideStartedAt: UtcInstant | null;
  pauseStartedAt: UtcInstant | null;
  lastBreastUsed: "left" | "right";
  timezone: string;
  version: number;
  deletedAt: UtcInstant | null;
}
```

Mutation rules:

- Start creates the session with the chosen `activeSide` and `activeSideStartedAt`.
- Switch first accrues elapsed seconds to the previous side, then starts the other side at the same effective instant.
- Pause accrues the active side, clears `activeSideStartedAt`, sets `pauseStartedAt`, and sets `status=paused`.
- Resume accrues `now - pauseStartedAt` to the pause total, clears `pauseStartedAt`, selects either side, and starts a new active interval.
- Stop accrues the active side or open pause as applicable, clears active fields, sets end/status, and preserves the final used side as `lastBreastUsed`.
- Reopening after process death derives the live total from stored totals plus `now - activeSideStartedAt`.
- Each mutation and outbox operation is atomic.

This satisfies Last/Next and split editing without reconstructing feed order from totals. Ordered segment history can be added later if arbitrary interval editing becomes a real requirement.

Nursing edit invariant:

```text
leftDurationSeconds + rightDurationSeconds + pauseDurationSeconds
= endedAt - startedAt
```

P0 does not need arbitrary pause interval editing. If the completed record contains no editable pauses, `pauseDurationSeconds` is zero.

Slider behavior:

- Slider range is `0...activeDurationSeconds`, step one second.
- Slider value is Left seconds; Right is the remainder.
- Start/end changes preserve the existing Left ratio to the nearest second.
- Preserve `lastBreastUsed` while both sides remain non-zero.
- If the edit changes one side to zero, the only non-zero side necessarily becomes Last and the UI announces that adjustment.
- Never infer Last from the longer side.

Before the first completed Nursing session, neither side is labelled Last/Next. Both are neutral start choices. The first selected/used side establishes Last after save.

### 5.5 Care events

```ts
type DiaperType = "dry" | "wet" | "dirty" | "mixed";

type CareEventData =
  | { kind: "diaper"; diaperType: DiaperType }
  | { kind: "medicine"; note: string }
  | { kind: "bath"; note?: string };
```

- Diaper type is required.
- Medicine note is required, trimmed for empty-input validation, and otherwise stored as entered.
- Medicine text must never be logged or published to Home Assistant/MQTT.
- Diaper weight and comments remain P1, even though the HTML demonstrates them.
- Bath remains nice-to-have and must not delay P0.

## 6. State-aware Home contract

Home derives actions from canonical local state. It does not keep a parallel screen-only state machine.

| Canonical sleep state | Slot 1 | Slot 2 | Centre status | Sleep live controller |
| --- | --- | --- | --- | --- |
| Awake, no sleep active | Night sleep | Nap | `Awake for …` or `Awake` | None |
| Nap active | Night sleep disabled | Current Nap | `Asleep for …` | `Nap · elapsed` |
| Night session, asleep phase | Wake up | Night waking | `Asleep for …` | `Night sleep · session elapsed` |
| Night session, awake phase | Wake up | Fell asleep again | `Awake tonight · …` | `Night waking · phase elapsed` |

Nursing, Medicine, and Diaper remain in slots 3–5 in every state.

Rules:

- `Fell asleep again` is required while the Night waking phase is active; do not leave a control that can create a second Night waking.
- Wake up is valid from either an asleep or awake night phase.
- Starting Night sleep or Nap is forbidden while another sleep session is active.
- Nursing may overlap Nap, Night sleep, or Night waking.
- Medicine and Diaper are instant events and may occur at any time.
- Disabled actions must explain why through accessible text; do not silently ignore taps.

## 7. Bottom drawer contract

### 7.1 Interaction semantics

The fast flow is two intentional taps: tap a Home action to open the drawer, then tap the primary control to start/save. There is no intermediate “Start now” versus “Set time” mode choice.

Drawer states:

| State | Visible content | Up gesture | Down gesture |
| --- | --- | --- | --- |
| Create, collapsed | Activity identity, current/default time, one primary action | Expand details | Dismiss without saving |
| Create, expanded | Exact date/time and type-specific secondary fields | Stay expanded | Collapse first; a continued/second downward gesture dismisses |
| Active | Live duration and activity controls | Expand correction fields | Minimize; never stop implicitly |
| Edit | Pre-filled exact record fields, Save, Delete | Already expanded | Dismiss without saving changes |

The handle is both draggable and tappable. Its accessibility role is adjustable, with labels describing expand/collapse/dismiss behavior.

Recommended initial gesture constants may reuse PR #10 and be tuned on both phones:

- Begin vertical capture after about 6 dp and only when vertical movement exceeds horizontal movement.
- Expand after about 38–40 dp upward or sufficiently fast upward velocity.
- Dismiss after about 72 dp downward or sufficiently fast downward velocity.
- Reduced-motion settings remove non-essential animation without removing gesture behavior.

### 7.2 Activity-specific collapsed content

| Activity | Collapsed primary control |
| --- | --- |
| Nap | Start at displayed time |
| Night sleep | Start bedtime at displayed time |
| Night waking | Start awake phase at displayed time |
| Fell asleep again | End waking/start asleep phase at displayed time |
| Wake up | End night session at displayed time |
| Nursing | Left and Right breast controls; tapping a breast starts immediately |
| Diaper | Four type choices and Save; default may be last used type only if explicitly designed later—P0 should not silently reuse it |
| Medicine | Free-text note and Save |

Exact date/time correction belongs in expanded content. The existing ±1 minute controls may remain in collapsed timed-action drawers because they reduce friction.

### 7.3 Persistent live controllers

The app can have one active sleep aggregate and one concurrent Nursing session. Render one controller per active user-manageable activity, stacked above bottom navigation/content with safe-area spacing.

- Nap: `Nap · 00:12:31`, Stop.
- Night asleep: `Night sleep · 04:14:08`, action opens session controls.
- Night awake: `Night waking · 00:08:22`, action opens resume/wake controls.
- Nursing: `Nursing · 00:16:03`, subtitle `L 08:51 · R 07:12`, Stop.

Tapping the controller body reopens its drawer. Stop/transition buttons must be separate accessible targets. Closing the drawer, navigating between Day/Night, backgrounding, or restarting must not stop a timer.

Timer displays derive from persisted start instants and accumulated totals, not from increment-only JavaScript counters.

## 8. Day/Night cycle and radial projection

### 8.1 Cycle identity and anchors

Night cycle:

- Identity: Night `SleepSession.id`.
- Start anchor: session `startedAt` (Bedtime).
- End anchor: session `endedAt` (Wake up), or open while active.
- Primary contents: the night sleep interval/phases plus Nursing, Diaper, and Medicine whose start instants fall within the session bounds.

Day cycle:

- Identity: preceding Night session ID plus its end instant.
- Start anchor: preceding Night session `endedAt` (Wake up).
- End anchor: next Night session `startedAt` (Bedtime), or open while active.
- Primary contents: Nap, Nursing, Diaper, and Medicine whose start instants fall within those bounds.

Boundary inclusion is half-open: `[cycleStart, cycleEnd)`. The boundary event is rendered in both neighboring views as a context anchor, but it has one canonical source record.

A timed record is owned by the cycle in which it starts. If it continues across a cycle boundary, the next cycle may render a clipped continuation arc at its leading edge, but it must not invent or duplicate a start icon. Tapping either representation opens the same canonical record.

### 8.2 Stable display scale

Use a fixed 24-hour horizon relative to the real cycle start, drawn over the design's 270-degree radial track:

```ts
elapsedMs = eventStartedAt - cycleStartedAt;
clampedMs = clamp(elapsedMs, 0, 24h);
angle = startAngle + (clampedMs / 24h) * sweepAngle;
```

Recommended constants from the design:

```ts
startAngle = 225 degrees;
sweepAngle = 270 degrees;
outerLaneRadius = 130;
innerLaneRadius = 108;
```

Why this differs from the HTML's hard-coded sample windows:

- It keeps the Wake up/Bedtime anchor at a stable visual start.
- It does not invent a predicted bedtime or wake time.
- Existing icons never drift as an active cycle grows.
- Cross-midnight arithmetic uses real instants and remains positive.

Tick labels show actual local clock times derived from `cycleStartedAt + offset`, not generic `+3h` text.

If a historical cycle exceeds 24 hours because of missing/incorrect boundaries, show an overflow/error affordance and keep the record editable; do not silently wrap it onto the start.

### 8.3 Missing anchors

- No Night session: Night view shows `No night sleep logged` and no fabricated Bedtime/Wake up.
- Legacy day data without a preceding Wake up: use a clearly labelled `Unanchored day` projection from local midnight so existing Nap records remain visible. Do not display a fake Wake up icon.
- Once a real Wake up exists, use the canonical Day-cycle projection.

### 8.4 Segments and lanes

For a timed record:

```ts
startAngle = project(record.startedAt);
endAngle = project(record.endedAt ?? now);
```

- The icon centre is at `startAngle`.
- The arc begins under/after the icon and extends clockwise to `endAngle`.
- Do not impose a fake minimum duration in the domain. A small visual minimum may make a very short event tappable, but its accessible label must report the real duration.
- Active arcs update from persisted start to current time.
- Editing immediately recomputes both angles.

Lanes:

- Outer lane: containing Night sleep or Nap intervals.
- Inner timed lane: Nursing and Night waking.
- Point-event lane/tokens: Medicine and Diaper.
- When tokens collide, use deterministic radial/label offsets without changing their time angle.

The exact color values are design tokens, not domain semantics. Follow the HTML's category palette and original visual identity; do not copy Napper artwork.

### 8.5 Interaction and accessibility

- Every icon/token is a `Pressable` with record ID in its callback: `onPressRecord(recordId)`.
- Never route every radial token to one generic action as the current Nap clock does.
- Minimum hit target: 44×44 dp, even if the visual token is smaller.
- Accessible label: activity type, local start time, duration/status, and selected category where relevant.
- Chronological Log remains the non-visual equivalent for screen-reader and precision use.

## 9. Record editor contracts

| Record | Required editor fields | Validation |
| --- | --- | --- |
| Active Nap | Start; Stop action/current proposed end | Start before now; Stop after start |
| Completed Nap | Start, End | End after start; no conflicting active sleep/overlap |
| Night session | Bedtime, Wake up if completed; phase list | Ordered alternating phases within session bounds |
| Night phase | Start, End where completed | No overlap; preserve alternation and one open phase |
| Nursing | Start, End, Left/Right split slider, totals | Duration invariant; valid Last side |
| Diaper | Timestamp, Dry/Wet/Dirty/Mixed | Exactly one type |
| Medicine | Timestamp, note | Non-empty note; no medical inference |

Save updates the exact stable ID with optimistic version protection. Delete follows the existing tombstone + five-second Undo pattern. A failed save leaves the drawer open with the user's proposal intact.

## 10. Recommended mobile module boundaries

Avoid extending the current nap files into a generic monolith.

```text
apps/mobile/src/features/
  home/
    today-screen.tsx
    home-action-state.ts
    active-controller-stack.tsx
  activity-drawer/
    activity-drawer.tsx
    drawer-gesture.ts
  timeline/
    cycle-projection.ts
    radial-cycle.tsx
    radial-lanes.ts
  sleep/
    sleep-drawer-content.tsx
    sleep-record-editor.tsx
    use-sleep-sessions.ts
  nursing/
    nursing-drawer-content.tsx
    nursing-record-editor.tsx
    nursing-repository.ts
  care-events/
    diaper-drawer-content.tsx
    medicine-drawer-content.tsx
    care-event-repository.ts
```

Domain modules remain framework-free:

```text
packages/domain/src/
  sleep.ts
  nursing.ts
  care-event.ts
  cycle-projection.ts  # only if it stays UI-framework independent
```

Use `react-native-svg` for precise arcs and tokens; it is not currently declared in the mobile package. Add it through the Expo-compatible installation path in the task that replaces the temporary View-based clock.

## 11. GitHub task update plan

### 11.1 Update issue #2 — Roadmap

Replace M4's “radial 24-hour timeline” wording with:

> Implement separate Day and Night cycle projections anchored at Wake up and Bedtime, start-anchored proportional radial segments, exact-record radial editing, chronological history, coherent cycle/date navigation, and lightweight daily summaries.

Add these cross-milestone dependencies:

- The reusable drawer and live-controller primitives begin in #3.
- Final cycle projection depends on the M2 Night aggregate.
- Nursing/Diaper/Medicine radial lanes depend on M3 entities.
- M4 integrates those entities; it must not redefine their persistence.

### 11.2 Update issue #3 and PR #10 before merge

Keep #3 nap-only. Do not pull the full Night/Nursing/Care-event scope into PR #10.

Amend Scope:

- The Nap action opens the functional draggable drawer; collapsed content has one Start/Stop action and expanded content exposes exact timestamps.
- A running Nap has a persistent live controller whose body reopens the drawer.
- Nap radial markers call the editor with the exact Nap ID.
- Completed/active Nap intervals render a start-anchored duration segment using a reusable projection/arc primitive.
- The final Day/Night cycle selector remains a later task.

Amend acceptance criteria:

- [ ] Up/down handle gestures expand/dismiss/minimize according to the drawer contract.
- [ ] Dismissing an active Nap drawer does not stop the Nap.
- [ ] The live timer derives from persisted timestamps and survives restart.
- [ ] Tapping any Nap marker edits that specific Nap, not merely the latest/current Nap.
- [ ] Every Nap icon is placed at the start and its arc length reflects duration.
- [ ] Longer edited duration produces a longer arc immediately.

Remove “Radial timeline implementation” from #3 Out of scope, or replace it with “Final multi-activity Day/Night cycle experience.”

### 11.3 Issue #11 — Night sleep aggregate and transitions

Outcome: the local domain and SQLite store one Night session containing alternating asleep/awake phases.

Required acceptance:

- [ ] Bedtime atomically creates Night session + first asleep phase + outbox operation.
- [ ] Night waking atomically closes asleep and opens awake in the same session.
- [ ] Fell asleep again atomically closes awake and opens asleep.
- [ ] Wake up closes the current phase and session from either phase kind.
- [ ] Only one active sleep session exists per child.
- [ ] Nap invariants and existing IDs/outbox behavior remain valid after migration.
- [ ] Cross-midnight and Europe/Lisbon DST transitions have domain/repository tests.
- [ ] Restarts recover the canonical active session and open phase.

Depends on: #3. Server sync broadening remains after M1 sync is proven.

### 11.4 Issue #12 — State-aware Night Home and drawers

Outcome: Home exposes only valid sleep transitions for the current local state.

Required acceptance:

- [ ] Day/awake shows Night sleep and Nap.
- [ ] Night/asleep shows Wake up and Night waking.
- [ ] Night/awake shows Wake up and Fell asleep again.
- [ ] Sleep controller reflects current phase while retaining the containing session.
- [ ] Wake up works from asleep and awake without creating a fake phase.
- [ ] Nursing/Medicine/Diaper slots remain available as later implementations arrive.
- [ ] Closing/minimizing drawers never changes canonical timer state.

Depends on: Night aggregate task.

### 11.5 Issue #13 — Nursing aggregate and live flow

Outcome: select either breast, track/switch/pause/resume/stop locally, and preserve Last/Next.

Required acceptance:

- [ ] Idle drawer labels the chronologically most recent completed session's `lastBreastUsed` as Last and the opposite as Next.
- [ ] Either side starts immediately.
- [ ] Only one side accrues time at once.
- [ ] Switching and pausing persist atomically and survive process death.
- [ ] Nursing may overlap any sleep state.
- [ ] Live controller shows total, Left, and Right from persisted state.
- [ ] Stop saves the final active side as Last.

### 11.6 Issue #14 — Nursing split editor

Outcome: edit Start/End and redistribute active duration with one slider without corrupting Last.

Required acceptance:

- [ ] Slider Left + Right equals available active duration to the second.
- [ ] Start/End changes preserve ratio within one second.
- [ ] Last remains unchanged while both sides are non-zero.
- [ ] A zero-side edit deterministically updates Last to the only used side and announces it.
- [ ] Stale versions preserve the user's proposal and surface conflict.
- [ ] Property-based/domain tests cover rounding and boundary values.

Depends on: Nursing aggregate task.

### 11.7 Issue #15 — Diaper and Medicine care events

Outcome: create/edit/delete typed point events through the shared drawer.

Required acceptance:

- [ ] Diaper create/edit share the same Dry/Wet/Dirty/Mixed selector.
- [ ] Edit preselects the persisted type.
- [ ] Icon, visible label, and non-color selected state exist for every type.
- [ ] Medicine stores timestamp plus non-empty unrestricted note.
- [ ] Medicine text never appears in logs, errors, analytics, or MQTT.
- [ ] Both event types use stable IDs, optimistic versions, tombstones, Undo, and outbox writes.

Bath, diaper weight, and comments are excluded from this task.

### 11.8 Issue #16 — Cycle projection engine

Outcome: derive stable Day/Night cycles and radial geometry from canonical entities.

Required acceptance:

- [ ] Day anchor is real Wake up; Night anchor is real Bedtime.
- [ ] Projection is fixed relative to the anchor and does not drift while active.
- [ ] Cross-midnight and DST calculations use real instants.
- [ ] Half-open boundary inclusion prevents duplicate content.
- [ ] Unanchored legacy days are explicit and never fabricate Wake up.
- [ ] Projection and collision-offset algorithms are deterministic and unit tested.

Depends on: Night aggregate task.

### 11.9 Issue #17 — Interactive multi-lane radial cycle

Outcome: render all implemented activity types with start tokens, proportional arcs, and exact-record editing.

Required acceptance:

- [ ] Day/Night selector preserves selected calendar context.
- [ ] Outer and inner lanes keep containing sleep and internal events legible.
- [ ] Every timed icon is at start; every arc grows clockwise by duration.
- [ ] Point events have tokens without fake arcs.
- [ ] Active arcs update from persisted state.
- [ ] Every token opens its exact record editor.
- [ ] Save/Delete immediately rerenders without app restart.
- [ ] 44×44 dp targets and complete accessible labels are verified.

Depends on: Cycle projection, Night, Nursing, and Care-event tasks.

### 11.10 Applied GitHub state

- [Roadmap #2](https://github.com/g-nogueira/baby-tracker/issues/2) now lists #11–#17 and the accepted cross-milestone dependencies.
- [Nap task #3](https://github.com/g-nogueira/baby-tracker/issues/3) now includes the drawer, live-controller, exact-record token, and duration-segment acceptance while remaining Nap-only.
- [Issue #11](https://github.com/g-nogueira/baby-tracker/issues/11) tracks the local Night aggregate and transitions.
- [Issue #12](https://github.com/g-nogueira/baby-tracker/issues/12) tracks state-aware Night Home actions and drawers.
- [Issue #13](https://github.com/g-nogueira/baby-tracker/issues/13) tracks Nursing Last/Next and live timing.
- [Issue #14](https://github.com/g-nogueira/baby-tracker/issues/14) tracks the Nursing split editor.
- [Issue #15](https://github.com/g-nogueira/baby-tracker/issues/15) tracks Diaper and Medicine events.
- [Issue #16](https://github.com/g-nogueira/baby-tracker/issues/16) tracks stable Day/Night projection.
- [Issue #17](https://github.com/g-nogueira/baby-tracker/issues/17) tracks the interactive multi-lane radial cycle.

All nine issues were re-read after mutation and remained open with the expected titles and bodies. PR #10 was not modified.

## 12. Test matrix

At minimum, each task must add tests at the lowest deterministic layer plus targeted UI-state tests.

| Scenario | Domain | Projection | SQLite | UI state | Device/E2E |
| --- | --- | --- | --- | --- | --- |
| Nap start/stop/edit/delete/Undo | ✓ | ✓ | ✓ | ✓ | ✓ |
| Exact radial record selection | — | ✓ | — | ✓ | ✓ |
| Bedtime → waking → asleep → wake | ✓ | ✓ | ✓ | ✓ | ✓ |
| Wake up during awake phase | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cross-midnight/DST cycle | ✓ | ✓ | ✓ | ✓ | ✓ |
| Nursing switch/pause/restart | ✓ | — | ✓ | ✓ | ✓ |
| Nursing split rounding/Last | ✓ | — | ✓ | ✓ | ✓ |
| Diaper type edit | ✓ | ✓ | ✓ | ✓ | ✓ |
| Medicine privacy | ✓ | — | ✓ | ✓ | ✓ |
| Concurrent Night + Nursing controllers | ✓ | ✓ | ✓ | ✓ | ✓ |

Required quality gates remain:

- `pnpm check`
- Relevant Expo Android export/native build
- `dotnet test BabyTracker.slnx` for backend/sync changes
- Migration upgrade test from the current v0.0.1/PR #10 schema, not only a fresh database

## 13. Visual acceptance map

Attach the two provided design sources to the origin handoff or relevant issues.

| Source | What it proves | Suggested issue attachment/caption |
| --- | --- | --- |
| `baby-tracker-record-editing-standalone.html` — Awake | Day/Night switch, start-anchored cycle, normal actions | “Target Home — awake/day state” |
| Same — Night sleep active | Wake up/Night waking action replacement | “Target Home — active night session” |
| Same — Nursing | Last/Next and either-side start | “Nursing start drawer” |
| Same — Nursing active | Independent side timers, switch/pause/stop, live controller | “Nursing active drawer/controller” |
| Same — tap Nursing radial icon | Start/End + one split slider | “Nursing edit invariant” |
| Same — Diaper / tap Diaper icon | Create/edit four-type selector | “Diaper create and edit” |
| `82812.mp4`, approximately 00:00–00:06 | Icons mark starts and timed trails show duration | “Napper behavioral reference — start markers” |
| `82812.mp4`, approximately 00:27–00:29 | Bedtime drawer and quick start-time correction | “Napper behavioral reference — bedtime drawer” |
| `82812.mp4`, approximately 00:30–00:34 | Active night state with Bedtime at the cycle start | “Napper behavioral reference — active night” |
| `82812.mp4`, approximately 00:04–00:07 | Tapping/editing the recorded Bedtime | “Napper behavioral reference — radial edit” |

Derived attachment: `baby-tracker-napper-behavior-reference.png` combines the four labelled reference states above for GitHub issue use.

Do not attach screenshots containing Napper assets as if they were the app's final visual design. Label them behavioral references. The standalone HTML is the authoritative original design direction.

## 14. Definition of done for this UX direction

The UX update is complete only when:

- The current Nap slice uses the reusable drawer/live/projection seams without regressing local-first guarantees.
- Day/Night actions are driven by canonical sleep state.
- Night session/phase invariants are persisted and tested.
- Nursing Last/Next and edit totals cannot contradict persisted state.
- Diaper type is editable through the same four-choice control used at creation.
- Separate cycle views use real Wake up/Bedtime anchors without prediction.
- Every radial event starts at its icon, has a truthful duration representation, and opens its exact record.
- Android and iPhone interaction checks cover gestures, safe areas, accessible targets, and concurrent controllers.
- The original offline/sync/conflict/Home Assistant guarantees remain unchanged unless a later issue explicitly updates them.

## 15. Explicit non-goals

- Pixel-for-pixel Napper clone.
- Napper illustrations, copy, sounds, or proprietary assets.
- Prediction or expected bedtime/wake-time generation.
- Advanced analytics/trends implementation.
- Arbitrary Nursing pause-interval editing in P0.
- Diaper weight/comment in P0.
- Bath if it delays required activities.
- Broadening M1 server sync beyond Nap before M1 convergence is proven.

## Appendix A — Active branch manifest

```yaml
schema_version: 1
record_type: life_os_branch
branch:
  id: BR-20260814-1451-baby-tracker-ux-implementation
  title: Baby Tracker UX implementation direction
  status: active
  created_at: 2026-08-14T14:51:20+01:00
ancestry:
  parent:
    visible_title: Napper-inspired Baby Tracker - Dev
    life_os_id: null
    platform_id: null
  parent_branch_id: null
  root_branch_id: null
scope:
  objective: Convert the accepted Napper-inspired design into an origin-ready implementation and GitHub-task specification.
  includes:
    - Current-code gap analysis
    - Domain and persistence contracts
    - UI state and gesture contracts
    - GitHub task deltas and acceptance criteria
    - Visual evidence map
  excludes:
    - Repository code changes
    - GitHub writes
    - Pixel-perfect Napper cloning
base:
  captured_at: 2026-08-14T14:51:20+01:00
  summary: PR #10 implements a local nap slice; a separate design branch accepted broader Day/Night, radial, Nursing, and Diaper behavior.
  facts:
    - id: FACT-BT-BASE-PR10
      statement: Draft PR #10 at dda26a5 contains the current nap-only drawer, live controller, and 24-hour point-marker timeline.
      status: current_observed
    - id: FACT-BT-DESIGN-HANDOFF
      statement: BR-20260814-1320-baby-tracker-napper-ux is ready for origin review and is the accepted design input.
      status: user_confirmed
  decisions:
    - id: DEC-BT-DESIGN-INPUT
      statement: Use the supplied design handoff and standalone HTML as the UX basis while preserving the repository's local-first architecture.
      status: accepted
  implementations:
    - id: IMP-BT-PR10
      statement: Nap CRUD, drawer gesture, live controller, SQLite/outbox, and nap-only radial point markers exist on PR #10.
      status: current_observed
  assumptions: []
  open_questions: []
  risks:
    - id: RISK-BT-SCOPE-CREEP
      statement: Pulling M2–M4 into PR #10 would delay M1 and destabilize proven local nap behavior.
storage:
  mode: file
  repository: null
  path: baby-tracker-ux-implementation-directive.md
merge:
  target: parent
  strategy: three_way
  status: pending
privacy:
  sensitivity: private
  excluded_material:
    - Raw family care records
    - Credentials and pairing secrets
```

## Appendix B — Merge-ready handoff

```yaml
schema_version: 1
record_type: life_os_branch_handoff
branch_id: BR-20260814-1451-baby-tracker-ux-implementation
status: ready_to_merge
closed_at: 2026-08-14T14:51:20+01:00
base_manifest_ref: Appendix A
latest_checkpoint_ref: null
executive_summary: >-
  Reconciles the accepted Napper-inspired design with PR #10 and the current
  normalized local-first architecture, then defines implementable state,
  persistence, projection, drawer, editor, task, and acceptance contracts.
changes:
  facts_added:
    - id: FACT-BT-PR10-GAP
      statement: PR #10 has a nap-only point-marker clock and generic marker routing; it is not the final Day/Night radial experience.
    - id: FACT-BT-GITHUB-TASKS-APPLIED
      statement: Roadmap #2 and Nap task #3 were updated, and implementation issues #11 through #17 were created and verified.
  corrections:
    - id: COR-BT-FLAT-ACTIVITY-MODEL
      statement: Preserve SleepSession/SleepPhase aggregates instead of adopting the HTML mockup's flat ActivityRecord persistence.
    - id: COR-BT-ISSUE3-RADIAL-SCOPE
      statement: Issue #3 and PR #10 currently disagree about whether radial work is in scope.
  decisions:
    - id: DEC-BT-CYCLE-PROJECTION
      statement: Use a fixed 24-hour cycle-relative horizon anchored at real Wake up/Bedtime over the design's radial sweep.
    - id: DEC-BT-SLEEP-AGGREGATE
      statement: Night waking persists as an awake phase within a Night SleepSession aggregate.
    - id: DEC-BT-NURSING-P0-MODEL
      statement: P0 Nursing persists side totals, active-side timing, and explicit lastBreastUsed.
    - id: DEC-BT-LIVE-CONTROLLERS
      statement: Support one sleep controller plus one concurrent Nursing controller.
  implementations:
    - id: IMP-BT-TASK-DIRECTIVE
      statement: Task-ready acceptance criteria were applied to issues #2/#3 and new M2–M4 issues #11–#17.
  rejected_alternatives:
    - id: REJ-BT-DYNAMIC-CYCLE-SCALE
      reason: It would move existing icons as an active cycle grows.
    - id: REJ-BT-PREDICTED-CYCLE-END
      reason: Prediction is explicitly out of scope.
    - id: REJ-BT-FLAT-ACTIVITY-PERSISTENCE
      reason: It duplicates existing normalized sleep semantics and weakens aggregate invariants.
  artifacts:
    - id: ART-BT-IMPLEMENTATION-DIRECTIVE
      location: baby-tracker-ux-implementation-directive.md
      status: verified
  assumptions_remaining: []
  open_questions: []
  risks:
    - id: RISK-BT-PR10-SCOPE
      statement: PR #10 should expose reusable Nap primitives without absorbing Night/Nursing/Care-event scope.
  supersessions: []
proposed_parent_patch:
  add:
    - FACT-BT-PR10-GAP
    - FACT-BT-GITHUB-TASKS-APPLIED
    - DEC-BT-CYCLE-PROJECTION
    - DEC-BT-SLEEP-AGGREGATE
    - DEC-BT-NURSING-P0-MODEL
    - DEC-BT-LIVE-CONTROLLERS
    - IMP-BT-TASK-DIRECTIVE
    - ART-BT-IMPLEMENTATION-DIRECTIVE
  update:
    - COR-BT-FLAT-ACTIVITY-MODEL
    - COR-BT-ISSUE3-RADIAL-SCOPE
  retire: []
  record_as_rejected:
    - REJ-BT-DYNAMIC-CYCLE-SCALE
    - REJ-BT-PREDICTED-CYCLE-END
    - REJ-BT-FLAT-ACTIVITY-PERSISTENCE
  keep_open:
    - RISK-BT-PR10-SCOPE
anticipated_conflicts:
  - id: CONFLICT-BT-PRODUCT-SPEC-RADIAL
    classification: branch_update
    detail: docs/product-spec.md currently specifies one 24-hour radial timeline rather than separate cycle-relative views.
    resolution: Apply this directive's Day/Night cycle contract and retain the rest of the existing product specification.
validation:
  source_references_checked: true
  sensitive_material_minimized: true
  contains_unresolved_conflicts: false
```

## Origin instruction

`Merge Life OS branch BR-20260814-1451-baby-tracker-ux-implementation using its handoff.`
