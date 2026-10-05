# Napper-inspired UX design assets

The 2026-10-05 feedback update takes precedence over historical HTML/screenshots: completed Nights fill the actual bedtime-to-wake dial; active Nights use a stepped provisional scale, with a midnight marker. Home uses line icons and last-action recency. Only Nap, Night Waking and Nursing get bottom timers. Crowded markers open exact-record lists, time values are tappable, and past activities/accidental Nap recovery are supported. See the implementation directive and `docs/mvp-status.md` for current behavior and native checks.


These files are implementation references for issues #2, #3, and #11–#17. The HTML is the canonical interactive behavior reference; screenshots are frozen visual examples. The implementation directive remains authoritative for domain, persistence, state-transition, testing, and non-goal decisions.

## Start here

1. Read [`implementation-directive.md`](./implementation-directive.md).
2. Open [`interactive-reference.html`](./interactive-reference.html) in a browser.
3. Use the scenario selector at the top of the HTML to inspect all required states.
4. Use the screenshots below for visual comparison, not as pixel-perfect cloning requirements.

## Scenario map

| Required behavior | HTML scenario | Screenshot | Primary issues |
| --- | --- | --- | --- |
| Night sleep active with concurrent Nursing and two persistent live controllers | `Night sleep + Nursing` | [`night-sleep-and-nursing-a.png`](./night-sleep-and-nursing-a.png), [`night-sleep-and-nursing-b.png`](./night-sleep-and-nursing-b.png) | #12, #13, #17 |
| First-ever Nursing with neutral Left/Right choices and no invented Last/Next | `First-ever Nursing` | [`first-nursing-no-history.png`](./first-nursing-no-history.png) | #13 |
| Night waking active with Wake up, Fell asleep again, “Awake tonight,” and a live controller | `Night waking active` | Render from the HTML | #12, #17 |
| Activity record create/edit flows, including Nursing split and Diaper type | Relevant editor scenarios | Render from the HTML | #14, #15 |

## Visual rules reinforced by the reference

- Event icons mark start times, never end times.
- Timed activities extend clockwise from their start icon.
- Night sleep and internal activities use separate radial lanes.
- Nap or Night Waking and concurrent Nursing keep separate persistent controllers; overall Night Sleep is a phase without a separate timer.
- Drawers are draggable and dismissible; dismissal does not mutate timer state.
- First-ever Nursing labels both sides neutrally.
- Napper branding and artwork are not implementation assets.

## Supporting overview

[`behavior-reference.png`](./behavior-reference.png) is a compact behavior/reference sheet derived from the accepted design direction.
