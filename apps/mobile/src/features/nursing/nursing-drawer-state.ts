import type { NursingSession, NursingSide } from '@baby-tracker/domain';

export type NursingDrawerControls =
  | { mode: 'create'; startSides: readonly ['left', 'right'] }
  | { mode: 'active'; switchTo: NursingSide; canPause: true; canStop: true }
  | { mode: 'paused'; resumeSides: readonly ['left', 'right']; canStop: true };

/** Exposes only valid live-flow actions; completed edit/delete controls belong to issue #14. */
export function nursingDrawerControls(session: NursingSession | null): NursingDrawerControls {
  if (session === null) return { mode: 'create', startSides: ['left', 'right'] };
  if (session.status === 'active') {
    return {
      mode: 'active',
      switchTo: session.activeSide === 'left' ? 'right' : 'left',
      canPause: true,
      canStop: true,
    };
  }
  if (session.status === 'paused') {
    return { mode: 'paused', resumeSides: ['left', 'right'], canStop: true };
  }
  throw new Error('Completed Nursing controls belong to the completed-session editor.');
}
