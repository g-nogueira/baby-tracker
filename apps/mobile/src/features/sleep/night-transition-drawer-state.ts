import type { NightSleepSession } from '@baby-tracker/domain';

export type NightTransitionKind =
  | 'start-night-sleep'
  | 'start-night-waking'
  | 'resume-night-sleep'
  | 'end-night-sleep';

export interface NightTransitionDraft {
  kind: NightTransitionKind;
  session: NightSleepSession | null;
  effectiveAt: Date;
}

export function createNightTransitionDraft(
  kind: NightTransitionKind,
  session: NightSleepSession | null,
  now: Date = new Date(),
): NightTransitionDraft {
  if (kind !== 'start-night-sleep' && session === null) {
    throw new Error('An active Night session is required for this transition.');
  }
  return { kind, session, effectiveAt: now };
}

export function adjustNightTransitionTime(
  draft: NightTransitionDraft,
  minutes: number,
  now: Date = new Date(),
): NightTransitionDraft {
  const proposed = draft.effectiveAt.getTime() + minutes * 60_000;
  return {
    ...draft,
    effectiveAt: new Date(Math.min(proposed, now.getTime())),
  };
}

export function updateNightTransitionTime(
  draft: NightTransitionDraft,
  effectiveAt: Date,
): NightTransitionDraft {
  return { ...draft, effectiveAt };
}

/** Keeps the exact instant shown in the drawer authoritative when saving. */
export function nightTransitionDraftForSave(draft: NightTransitionDraft): NightTransitionDraft {
  return draft;
}

/** Returns the persisted instant that drives an active Night controller, if one exists. */
export function activeNightDurationStartedAt(session: NightSleepSession): string | null {
  const openPhase = session.phases.at(-1);
  if (session.status !== 'active' || openPhase === undefined || openPhase.endedAt !== null)
    return null;
  return openPhase.kind === 'awake' ? openPhase.startedAt : session.startedAt;
}

export function nightTransitionError(
  draft: NightTransitionDraft,
  now: Date = new Date(),
): string | null {
  const transitionMs = draft.effectiveAt.getTime();
  if (!Number.isFinite(transitionMs)) return 'Enter a valid date and time.';
  if (transitionMs > now.getTime()) return 'Night transition time cannot be in the future.';

  if (draft.kind !== 'start-night-sleep' && draft.session === null) {
    return 'An active Night session is required for this transition.';
  }
  if (draft.kind === 'start-night-sleep' && draft.session !== null) {
    return 'Night sleep is already active.';
  }
  if (draft.session !== null) {
    const openPhase = draft.session.phases.at(-1);
    if (
      draft.session.status !== 'active' ||
      draft.session.deletedAt !== null ||
      openPhase === undefined ||
      openPhase.endedAt !== null
    ) {
      return 'The active Night phase could not be found.';
    }
    if (draft.kind === 'start-night-waking' && openPhase.kind !== 'asleep')
      return 'Night waking is already active.';
    if (draft.kind === 'resume-night-sleep' && openPhase.kind !== 'awake')
      return 'Night sleep is already running.';
    if (transitionMs <= new Date(openPhase.startedAt).getTime()) {
      return 'Transition time must be after the current phase started.';
    }
  }

  return null;
}
