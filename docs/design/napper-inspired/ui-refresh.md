# Napper tracking UI parity

This revision replaces the earlier visual refresh with tracking layouts based on the supplied
Napper JavaScript and screenshots. **Exact parity is still incomplete.** Original artwork/fonts,
broader Napper features and installed-phone acceptance remain outstanding.

## References and recovered values

The supplied Hermes listing was inspected as a reference; it is not executed or included in the
repository. The palette declares `#121127` → `#1B1A3D` backgrounds, `#8587FF` primary purple,
`#C4C4F3` secondary text and `#F9F8F6` foreground. It references Saans Regular/Medium fonts and
bitmap activity symbols. Screenshot references show the dark surface for both Day and Night,
a large C-shaped dial, small status labels, icon actions with recency, persistent side controls
and collapsed record drawers with clock ranges.

The original warm HTML handoff predates the user's request for Napper parity; it no longer
sets the connected client's appearance. The separate local tracker remains available.

## Implemented

- Dark connected surfaces for both cycles; moved cycle switching into an icon pill on the dial.
- Enlarged the dial to use the phone width and removed the large name header/segmented switch.
- Kept midnight visible and placed timed activity markers at their start, independently of duration.
- Added vertical swiping between the dial and history, and a five-position dock. Home, Add and History work;
  the sound/library positions are dim, non-interactive slots because those features are unavailable.
- Added an activity menu to `+`; historical dates still open past-activity entry directly.
- Added L/R switch, pause and resume to the persistent Nursing bar alongside its stop control.
- Added larger drawer symbols, clock ranges without repeated AM/PM, duration/age captions,
  round primary actions and native expansion from the options button.
- Preserved exact timestamp drafts, continuous Nursing split updates and native TrueSheet ownership.
- Preserved the replaceable care ports, authoritative Napper writes and collision/stale-save guards.

Individual Nap, Night waking, Nursing, Diaper and Medicine removal still requires confirmation
of the reviewed revision. The adapter rereads before DELETE and confirms absence afterwards;
uncertain outcomes require refresh. Bedtime/Wake-up deletion remains unavailable independently.

## Missing assets and remaining differences

The JavaScript references these assets, but their actual files were not supplied:

- `Saans-Regular.ttf` and `Saans-Medium.ttf`.
- Activity bitmaps under `src/assets/img/space/icons`, including bedtime, wake-up, nap,
  night-waking, nursing, diaper and medicine symbols.

Current line glyphs and system fonts are temporary fallbacks. The source bitmap artwork,
font metrics, gradients/glows and animations are not claimed to match. An APK or the decoded
font/drawable assets is needed to finish that part faithfully.

Sleep predictions, the complete weekly/history presentation, sounds and the sleep-content library
are not implemented by this tracking port. No predictions, future wake-up anchors or working
sound/library destinations are fabricated. Full app parity includes those separate capabilities.

## Review and validation

`pnpm preview:ui` runs the actual connected components with synthetic records and browser adapters
for native sheets, pickers and SVG. Preview commands never contact Napper; ordinary writes show a
preview-only message and Remove affects synthetic memory only. `--build` creates a standalone
browser preview; `--static` emits static component markup.

The PNGs below are **static component renders through a CSS print engine**, not browser/device
screenshots. They help inspect hierarchy and geometry; native fonts, stacking, gestures, keyboard
behavior and safe areas still need Android/iPhone validation. No live browser visual pass is claimed.

| Day | Night |
| --- | --- |
| ![Day](ui-refresh/day.png) | ![Night](ui-refresh/night.png) |

| Completed Nap | Running Nursing | First Nursing |
| --- | --- | --- |
| ![Nap](ui-refresh/nap-drawer.png) | ![Nursing](ui-refresh/nursing.png) | ![First Nursing](ui-refresh/first-nursing.png) |

Validation passed: `pnpm check` (447 tests), the Lisbon timezone care/timeline suite
(144 tests), Android/iOS JavaScript exports and the standalone preview build.
The connected-home tests execute Expo's Android transform with React Compiler enabled, including
a production render. They cover history navigation, empty-night cycle switching, the activity
menu, persistent Nursing controls, clock updates and reopened feeds. A marker regression verifies
that changing an activity's end does not move its start marker.

On a test profile, compare each state side by side with Napper on both phones: home, current and
historical cycles, first/active/paused/completed Nursing, Nap, Night waking, past care, exact time
editing, nearby records, removal, drawer dragging, enlarged fonts and the keyboard. No development
writes were made to the family's real account.
