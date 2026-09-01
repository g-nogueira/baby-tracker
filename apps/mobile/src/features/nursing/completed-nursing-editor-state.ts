import {
  assertValidNursingSession,
  type CompletedNursingCorrection,
  correctedNursingLastBreast,
  type NursingSession,
  type NursingSide,
} from '@baby-tracker/domain';

export interface CompletedNursingEditorState {
  session: Readonly<NursingSession>;
  startedAt: Date;
  endedAt: Date;
  leftDurationSeconds: number;
  lastBreastUsed: NursingSide;
  lastAdjustmentAnnouncement: string | null;
  leftRatioNumerator: number;
  leftRatioDenominator: number;
}

export interface CompletedNursingEditorTotals {
  elapsedDurationSeconds: number | null;
  activeDurationSeconds: number | null;
  leftDurationSeconds: number;
  rightDurationSeconds: number | null;
  pauseDurationSeconds: number;
}

export type CompletedNursingBoundary = 'startedAt' | 'endedAt';

/** Creates a pure correction draft from one visible completed Nursing session. */
export function createCompletedNursingEditorState(
  session: NursingSession,
): CompletedNursingEditorState {
  assertValidNursingSession(session);
  if (session.status !== 'completed' || session.endedAt === null || session.deletedAt !== null) {
    throw new Error('Only a visible completed Nursing session can be edited.');
  }
  const activeDurationSeconds = session.leftDurationSeconds + session.rightDurationSeconds;
  const ratio =
    activeDurationSeconds === 0
      ? fallbackRatio(session.lastBreastUsed)
      : { numerator: session.leftDurationSeconds, denominator: activeDurationSeconds };
  const state: CompletedNursingEditorState = {
    session: Object.freeze({ ...session }),
    startedAt: new Date(session.startedAt),
    endedAt: new Date(session.endedAt),
    leftDurationSeconds: session.leftDurationSeconds,
    lastBreastUsed: session.lastBreastUsed,
    lastAdjustmentAnnouncement: null,
    leftRatioNumerator: ratio.numerator,
    leftRatioDenominator: ratio.denominator,
  };
  return applySplit(state, session.leftDurationSeconds, activeDurationSeconds);
}

/** Changes one boundary and rescales the split when the proposed interval becomes valid. */
export function updateCompletedNursingBoundary(
  state: CompletedNursingEditorState,
  boundary: CompletedNursingBoundary,
  value: Date,
): CompletedNursingEditorState {
  const next = {
    ...state,
    [boundary]: new Date(value.getTime()),
    lastAdjustmentAnnouncement: null,
  };
  const activeDurationSeconds = availableActiveDurationSeconds(next);
  if (activeDurationSeconds === null) return next;
  const leftDurationSeconds = proportionalLeftSeconds(
    activeDurationSeconds,
    state.leftRatioNumerator,
    state.leftRatioDenominator,
  );
  return applySplit(next, leftDurationSeconds, activeDurationSeconds);
}

/** Sets the one editable split value; Right remains the exact active-duration remainder. */
export function updateCompletedNursingLeftSeconds(
  state: CompletedNursingEditorState,
  leftDurationSeconds: number,
): CompletedNursingEditorState {
  const activeDurationSeconds = availableActiveDurationSeconds(state);
  if (
    activeDurationSeconds === null ||
    !Number.isSafeInteger(leftDurationSeconds) ||
    leftDurationSeconds < 0 ||
    leftDurationSeconds > activeDurationSeconds
  ) {
    throw new Error('Left seconds must be a whole value within the current active duration.');
  }
  const ratio =
    activeDurationSeconds === 0
      ? {
          numerator: state.leftRatioNumerator,
          denominator: state.leftRatioDenominator,
        }
      : { numerator: leftDurationSeconds, denominator: activeDurationSeconds };
  return {
    ...applySplit(state, leftDurationSeconds, activeDurationSeconds),
    leftRatioNumerator: ratio.numerator,
    leftRatioDenominator: ratio.denominator,
  };
}

/** Derives Right and aggregate totals without storing a second editable split value. */
export function completedNursingEditorTotals(
  state: CompletedNursingEditorState,
): CompletedNursingEditorTotals {
  const elapsedDurationSeconds = elapsedWholeSeconds(state.startedAt, state.endedAt);
  const activeDurationSeconds = availableActiveDurationSeconds(state);
  return {
    elapsedDurationSeconds,
    activeDurationSeconds,
    leftDurationSeconds: state.leftDurationSeconds,
    rightDurationSeconds:
      activeDurationSeconds === null ? null : activeDurationSeconds - state.leftDurationSeconds,
    pauseDurationSeconds: state.session.totalPauseDurationSeconds,
  };
}

/** Validates a proposed completed correction while leaving invalid draft values untouched. */
export function completedNursingEditorError(
  state: CompletedNursingEditorState,
  now: Date = new Date(),
): string | null {
  const startedAt = state.startedAt.getTime();
  const endedAt = state.endedAt.getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
    return 'Enter valid Nursing start and end times.';
  }
  if (startedAt % 1_000 !== 0 || endedAt % 1_000 !== 0) {
    return 'Nursing corrections must use whole-second times.';
  }
  if (startedAt > now.getTime() || endedAt > now.getTime()) {
    return 'Nursing times cannot be in the future.';
  }
  if (endedAt < startedAt) return 'Nursing end time must not precede its start time.';

  const totals = completedNursingEditorTotals(state);
  if (totals.activeDurationSeconds === null) {
    return 'Nursing duration cannot be shorter than the preserved pause time.';
  }
  if (
    !Number.isSafeInteger(state.leftDurationSeconds) ||
    state.leftDurationSeconds < 0 ||
    totals.rightDurationSeconds === null ||
    totals.rightDurationSeconds < 0
  ) {
    return 'Left seconds must remain within the available active duration.';
  }
  const expectedLast = correctedNursingLastBreast(
    state.session.lastBreastUsed,
    state.leftDurationSeconds,
    totals.rightDurationSeconds,
  );
  if (state.lastBreastUsed !== expectedLast) {
    return 'Last breast must match the corrected Left and Right split.';
  }
  return null;
}

/** Produces the framework-free domain command only from a valid editor proposal. */
export function completedNursingCorrectionForSave(
  state: CompletedNursingEditorState,
  now: Date = new Date(),
): CompletedNursingCorrection {
  const error = completedNursingEditorError(state, now);
  if (error !== null) throw new Error(error);
  return {
    startedAt: new Date(state.startedAt.getTime()),
    endedAt: new Date(state.endedAt.getTime()),
    leftDurationSeconds: state.leftDurationSeconds,
  };
}

function applySplit(
  state: CompletedNursingEditorState,
  leftDurationSeconds: number,
  activeDurationSeconds: number,
): CompletedNursingEditorState {
  const rightDurationSeconds = activeDurationSeconds - leftDurationSeconds;
  const lastBreastUsed = correctedNursingLastBreast(
    state.session.lastBreastUsed,
    leftDurationSeconds,
    rightDurationSeconds,
  );
  return {
    ...state,
    leftDurationSeconds,
    lastBreastUsed,
    lastAdjustmentAnnouncement: zeroSideAnnouncement(
      state.session.lastBreastUsed,
      lastBreastUsed,
      leftDurationSeconds,
      rightDurationSeconds,
    ),
  };
}

function zeroSideAnnouncement(
  originalLast: NursingSide,
  correctedLast: NursingSide,
  leftDurationSeconds: number,
  rightDurationSeconds: number,
): string | null {
  const zeroSide =
    leftDurationSeconds === 0 && rightDurationSeconds > 0
      ? 'Left'
      : rightDurationSeconds === 0 && leftDurationSeconds > 0
        ? 'Right'
        : null;
  if (zeroSide === null) return null;
  const lastLabel = correctedLast === 'left' ? 'Left' : 'Right';
  return correctedLast === originalLast
    ? `${lastLabel} remains Last because ${zeroSide} is now zero.`
    : `Last changed to ${lastLabel} because ${zeroSide} is now zero.`;
}

function availableActiveDurationSeconds(state: CompletedNursingEditorState): number | null {
  const elapsedDurationSeconds = elapsedWholeSeconds(state.startedAt, state.endedAt);
  if (
    elapsedDurationSeconds === null ||
    elapsedDurationSeconds < state.session.totalPauseDurationSeconds
  ) {
    return null;
  }
  return elapsedDurationSeconds - state.session.totalPauseDurationSeconds;
}

function elapsedWholeSeconds(startedAt: Date, endedAt: Date): number | null {
  const start = startedAt.getTime();
  const end = endedAt.getTime();
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start % 1_000 !== 0 ||
    end % 1_000 !== 0 ||
    end < start
  ) {
    return null;
  }
  const elapsed = (end - start) / 1_000;
  return Number.isSafeInteger(elapsed) ? elapsed : null;
}

function proportionalLeftSeconds(
  activeDurationSeconds: number,
  ratioNumerator: number,
  ratioDenominator: number,
): number {
  const left = Math.round(activeDurationSeconds * (ratioNumerator / ratioDenominator));
  return Math.min(activeDurationSeconds, Math.max(0, left));
}

function fallbackRatio(lastBreastUsed: NursingSide) {
  return lastBreastUsed === 'left'
    ? { numerator: 1, denominator: 1 }
    : { numerator: 0, denominator: 1 };
}
