# MVP status and Night regression checks

Reviewed against `agent/issue-14-17-final`, PR #26, and the accepted
`docs/design/napper-inspired` reference. This is a local-flow hardening increment,
not a completed shared-caregiver MVP.

## Changes in this increment

- Nursing start/stop no longer projects against an older idle clock tick. The render samples current wall time while pure domain projection still rejects invalid future data.
- Android picker value and callback identities remain fixed for one dialog opening, so live ticks cannot reset an unconfirmed hour, minute or AM/PM. iOS spinners remain controlled.
- Nap, Nursing and Night transition proposed times are tappable before starting. Expanded active drawers focus on Start/End rather than repeating a large elapsed counter.
- The drawer handle owns its gesture from touch-down, survives clock renders, and collapses/dismisses independently of content scrolling. Nursing split updates during horizontal movement and retains one complementary L/R value.
- Wake-up and Bedtime anchors open their canonical Night editor. Night editing uses the session's saved timezone.
- Completed Naps expose **Continue this nap**, retaining the same record, phase and original start. Later sleep overlaps, another active sleep, and stale versions reject the change atomically.
- **Add past activity** records completed Nap/Night/Nursing, inserts a completed waking within an asleep phase, or backdates Diaper/Medicine. Completed entries never start a live timer. Existing data and outbox commits stay atomic.
- Home uses original line icons with last-action recency across calendar days. Nap/Nursing stops use square controls. Night Sleep has no separate bottom timer; Night Waking, Nap and Nursing remain reachable while browsing history.
- Completed Night scales fit Bedtime → Wake up. Active Nights use 12h minimum, extending in 3h steps to 24h without inventing an end. Canonical ownership and overflow remain unchanged. Midnight markers respect the originating timezone.
- Dense markers sit on a bounded rail and open an exact-record chooser. Smaller center labels give duration priority without covering point events.
- Earlier increment behavior remains: Night phase correction/deletion/Undo, versioned stale-write rejection, live Nursing corrections preserving side/pause/Last, and SQLite v5 retirement metadata.

Automated checks cover domain validation, real SQLite persistence/restart/outbox rollback, stale and overlap rejection, rendered routes, picker prop identity, continuous slider changes and clock-race regression. Native primitives are mocked in interaction tests; exports verify bundling, not native gestures.

## Device checks before merging

Use synthetic records; do not clear an existing care database.

1. Start Nursing between idle clock ticks. Verify no app exit, then switch/pause/stop and restart.
2. Open a Diaper time picker while another activity runs. Adjust hour/minute/AM-PM, wait through ticks, then confirm. The selection must remain stable on Android and iOS.
3. Tap the proposed Nap, Nursing, Wake-up and Night-waking times while collapsed. Backdate and start; verify the exact saved timestamp after restart.
4. Drag expanded Nap/Nursing handles down, then dismiss from collapsed. Repeat while seconds tick and while content is scrolled. The gesture must never stop the activity.
5. Drag the Nursing L/R split slowly in each direction. It follows the finger; totals stay complementary. Check screenreader adjustment actions.
6. Stop a Nap by mistake. Open it, choose **Continue this nap**, then stop later; verify its original start and one record. A later/conflicting sleep must block continuation.
7. Select a past Night, add a waking and Nursing/Diaper/Medicine. Verify those exact records after restart, with no live timer. A waking must fit within one sleeping phase.
8. Tap final Wake up on either neighboring dial, edit, save and restart. Repeat with a record timezone differing from the device timezone.
9. Check completed bedtime/wake endpoints fill the Night dial, Midnight placement including DST, dense-record chooser, 44dp targets, small screens and large text.
10. During Night Sleep, only Nursing has a bottom controller if running. During Night Waking, both waking and Nursing remain independently reachable in history. Check Night correction, waking delete/Undo and midnight continuity from the earlier increment.

## Remaining MVP work

| Order | Gap | Evidence / next step |
| --- | --- | --- |
| 1 | Household enrollment and device auth | `Program.cs` exposes health checks only; mobile IDs are fixed. Implement #4. |
| 2 | Second-caregiver pairing/revocation | No enrollment UI or pairing endpoints. Implement #5. |
| 3 | Canonical Nap sync and explicit conflicts | Local outbox exists; server push/pull and mobile transport do not. Implement #6–#8. |
| 4 | Android/iPhone offline convergence | Run #9 on both phones and the intended server before extending sync beyond Naps. |
| 5 | Sync Night, Nursing, Diaper, Medicine | Extend the proven aggregate protocol; preserve all local proposals. |
| 6 | Home Assistant and recovery | MQTT publishing, secure device storage, export/backup/restore and release recovery remain unimplemented. |
| 7 | Release evidence | Native interaction checks, outage/restart tests and the specified seven-day two-caregiver trial remain required. |

Keep prediction, advanced analytics and optional Bath out of the critical path.
