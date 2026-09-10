import {
  assertValidSleepSession,
  type NightSleepSession,
  type SleepPhaseBoundary,
} from '@baby-tracker/domain';

export interface NightRecordEditorState {
  session: NightSleepSession;
  /** Null selects the containing Night; otherwise this is the exact awake phase ID. */
  phaseId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  mode: 'active' | 'edit';
}

export function createNightRecordEditorState(
  session: NightSleepSession,
  phaseId: string | null = null,
  mode: NightRecordEditorState['mode'] = 'edit',
): NightRecordEditorState {
  assertValidSleepSession(session);
  if (session.deletedAt !== null) throw new Error('This Night sleep was deleted.');
  const record = phaseId === null ? session : session.phases.find((phase) => phase.id === phaseId);
  if (record === undefined || (phaseId !== null && record.kind !== 'awake')) {
    throw new Error('This Night waking could not be found.');
  }
  return {
    session,
    phaseId,
    startedAt: new Date(record.startedAt),
    endedAt: record.endedAt === null ? null : new Date(record.endedAt),
    mode: record.endedAt === null ? mode : 'edit',
  };
}

export function nightRecordEditorChanged(editor: NightRecordEditorState): boolean {
  const record =
    editor.phaseId === null
      ? editor.session
      : editor.session.phases.find((phase) => phase.id === editor.phaseId);
  return (
    record === undefined ||
    editor.startedAt.getTime() !== new Date(record.startedAt).getTime() ||
    (editor.endedAt?.getTime() ?? null) !==
      (record.endedAt === null ? null : new Date(record.endedAt).getTime())
  );
}

/** A shared boundary moves both neighbours, preserving a contiguous, versioned aggregate. */
export function nightRecordBoundariesForSave(editor: NightRecordEditorState): SleepPhaseBoundary[] {
  const phases = editor.session.phases.map((phase) => ({
    id: phase.id,
    startedAt: new Date(phase.startedAt),
    endedAt: phase.endedAt === null ? null : new Date(phase.endedAt),
  }));
  const index =
    editor.phaseId === null ? 0 : phases.findIndex((phase) => phase.id === editor.phaseId);
  const first = phases[index];
  const last = editor.phaseId === null ? phases.at(-1) : first;
  if (first === undefined || last === undefined)
    throw new Error('This Night record could not be found.');
  first.startedAt = editor.startedAt;
  last.endedAt = editor.endedAt;
  if (editor.phaseId !== null) {
    const previous = phases[index - 1];
    const next = phases[index + 1];
    if (previous !== undefined) previous.endedAt = editor.startedAt;
    if (next !== undefined && editor.endedAt !== null) next.startedAt = editor.endedAt;
  }
  return phases;
}

export function nightRecordEditorError(
  editor: NightRecordEditorState,
  now = new Date(),
): string | null {
  try {
    const boundaries = nightRecordBoundariesForSave(editor);
    for (const boundary of boundaries) {
      for (const date of [boundary.startedAt, boundary.endedAt]) {
        if (date === null) continue;
        if (!Number.isFinite(date.getTime())) return 'Enter a valid date and time.';
        if (date.getTime() > now.getTime()) return 'Night times cannot be in the future.';
      }
    }
    const phases = editor.session.phases.map((phase, index) => ({
      ...phase,
      startedAt: boundaries[index].startedAt.toISOString(),
      endedAt: boundaries[index].endedAt?.toISOString() ?? null,
    }));
    assertValidSleepSession({
      ...editor.session,
      startedAt: phases[0].startedAt,
      endedAt: phases.at(-1)?.endedAt ?? null,
      phases,
    });
    return null;
  } catch (error: unknown) {
    return error instanceof Error ? error.message : 'Check the Night times.';
  }
}
