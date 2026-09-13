# MVP status and Night regression checks

Reviewed against `agent/issue-14-17-final`, PR #26, and the accepted
`docs/design/napper-inspired` reference. This is a local-flow hardening increment,
not a completed shared-caregiver MVP.

## Changes in this increment

- Controller bodies open the active Night sleep/waking record. Home quick actions
  open transition forms with the proposed wall-clock time, not another activity's timer.
- Active Night and Night-waking starts can be corrected. Completed waking tokens
  edit that exact phase, updating shared neighbouring boundaries atomically.
- Night corrections accept the millisecond timestamps produced by real logging.
- Active actions use the displayed session version. Stale edits/transitions fail
  without dropping the draft or overwriting newer data.
- Timer rerenders preserve the drawer gesture handler. Nap start correction is
  reachable from its live drawer; Night/Nap details scroll and avoid the keyboard.
- Each Night waking can be deleted with Undo. Adjacent sleep is joined within the
  same Night; retired phase rows stay in SQLite and Undo restores the original IDs.
  Database v5 adds explicit retirement metadata without clearing existing records.
- Active/paused Nursing supports start-time and L/R split correction. The editor
  fixes its reviewed totals at opening; elapsed time afterward still accrues to the
  running side or pause. Saved corrections preserve live state and Last.
- Live controllers remain visible during history browsing. Today opens the active
  Night and retains its cycle after midnight. Very narrow action rows wrap.

Automated coverage includes rendered drawer/controller routing with mocked native
primitives, gesture-handler stability, midnight projection, exact-phase correction,
and real SQLite persistence/restart/stale-write rollback. These tests do not replace
Android/iPhone gesture and native date-picker checks.

## Device checks before merging

Use synthetic records; do not clear an existing care database.

1. Start Night sleep. Open its controller: title **Night sleep**, elapsed duration,
   **Wake up** button. Tap the handle and drag up from the sheet; both expose Bedtime.
2. Correct Bedtime, save, close/reopen, then restart. Verify the time and live clock.
3. Open **Night waking** before starting: a proposed clock time and **Start**.
   Dismiss: no new record. Reopen/start: waking begins at that proposed time.
4. Open the waking controller: **Night waking**, **Awake tonight**, waking duration,
   **Fell asleep again**. Correct its start and verify the adjacent sleep boundary.
5. Use the Home **Fell asleep again** action to backdate the transition. Its form
   shows the proposed time. Resume does not end the overall Night.
6. Tap a previous waking token while a later phase is running. Edit only that waking;
   verify the current phase and containing Night remain active.
7. Wake up from both asleep and awake phases; verify no extra phase is created.
8. Start Nursing during Night; verify both controllers, independent stop, pause,
   side switch, and restart. Browse history while timers run; both stay reachable.
9. Cross midnight with Night active. Today must retain that Night's arc and events.
10. Delete a previous waking and the currently running waking; Undo each. Verify
    the Night remains intact, the elapsed totals change, and restart retains the result.
11. Expand active/paused Nursing, tap **Edit start time and split**, correct the start,
    adjust L/R, wait a minute, and save. Check that minute is still counted on the
    current breast/pause and that stop/resume/side switching still work.
12. Test a small screen, large text, open keyboard, and iOS date/time spinners.
    Drag while seconds tick; collapse/dismiss must never stop the activity.

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
