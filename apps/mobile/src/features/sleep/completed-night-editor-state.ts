import type { NightSleepSession, SleepPhaseBoundary } from '@baby-tracker/domain';

export interface CompletedNightEditorState {
  bedtime: Date;
  session: Readonly<NightSleepSession>;
  wakeUp: Date;
}

export type CompletedNightBoundary = 'bedtime' | 'wakeUp';

/** Creates a boundary-only proposal while retaining the canonical phase list. */
export function createCompletedNightEditorState(
  session: NightSleepSession,
): CompletedNightEditorState {
  if (session.status !== 'completed' || session.endedAt === null || session.deletedAt !== null) {
    throw new Error('Only visible completed Night sleep can be edited.');
  }
  return {
    bedtime: new Date(session.startedAt),
    session: Object.freeze({ ...session, phases: session.phases.map((phase) => ({ ...phase })) }),
    wakeUp: new Date(session.endedAt),
  };
}

export function updateCompletedNightBoundary(
  state: CompletedNightEditorState,
  boundary: CompletedNightBoundary,
  value: Date,
): CompletedNightEditorState {
  return { ...state, [boundary]: new Date(value.getTime()) };
}

export function completedNightEditorError(
  state: CompletedNightEditorState,
  now: Date = new Date(),
): string | null {
  const bedtime = state.bedtime.getTime();
  const wakeUp = state.wakeUp.getTime();
  if (!Number.isFinite(bedtime) || !Number.isFinite(wakeUp))
    return 'Enter valid Bedtime and Wake up values.';
  if (bedtime % 1_000 !== 0 || wakeUp % 1_000 !== 0)
    return 'Night corrections must use whole-second times.';
  if (bedtime > now.getTime() || wakeUp > now.getTime())
    return 'Night times cannot be in the future.';
  if (wakeUp <= bedtime) return 'Wake up must occur after Bedtime.';

  const first = state.session.phases[0];
  const last = state.session.phases.at(-1);
  if (first === undefined || last === undefined) return 'Night sleep requires at least one phase.';
  const firstEnd = first === last ? wakeUp : new Date(first.endedAt ?? '').getTime();
  const lastStart = first === last ? bedtime : new Date(last.startedAt).getTime();
  if (!Number.isFinite(firstEnd) || bedtime >= firstEnd)
    return 'Bedtime must precede the first phase transition.';
  if (!Number.isFinite(lastStart) || wakeUp <= lastStart)
    return 'Wake up must follow the final phase transition.';
  return null;
}

/** Emits all preserved phase identities with only the outer boundaries changed. */
export function completedNightBoundariesForSave(
  state: CompletedNightEditorState,
  now: Date = new Date(),
): SleepPhaseBoundary[] {
  const error = completedNightEditorError(state, now);
  if (error !== null) throw new Error(error);
  const lastIndex = state.session.phases.length - 1;
  return state.session.phases.map((phase, index) => ({
    id: phase.id,
    startedAt: index === 0 ? new Date(state.bedtime) : new Date(phase.startedAt),
    endedAt:
      index === lastIndex
        ? new Date(state.wakeUp)
        : phase.endedAt === null
          ? null
          : new Date(phase.endedAt),
  }));
}
