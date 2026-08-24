import type {
  CareEvent,
  DiaperCareEvent,
  DiaperType,
  MedicineCareEvent,
} from '@baby-tracker/domain';

export type CareEventDrawerState =
  | { mode: 'create'; kind: 'diaper'; occurredAt: Date; diaperType: DiaperType | null }
  | { mode: 'create'; kind: 'medicine'; occurredAt: Date; note: string }
  | {
      mode: 'edit';
      kind: 'diaper';
      event: DiaperCareEvent;
      occurredAt: Date;
      diaperType: DiaperType;
    }
  | { mode: 'edit'; kind: 'medicine'; event: MedicineCareEvent; occurredAt: Date; note: string };

/** Creates a blank point-event draft without silently selecting a Diaper type. */
export function createCareEventDraft(
  kind: 'diaper' | 'medicine',
  occurredAt: Date = new Date(),
): CareEventDrawerState {
  return kind === 'diaper'
    ? { mode: 'create', kind, occurredAt, diaperType: null }
    : { mode: 'create', kind, occurredAt, note: '' };
}

/** Loads the exact persisted record and version into its type-specific editor. */
export function editCareEventDraft(event: CareEvent): CareEventDrawerState {
  return event.kind === 'diaper'
    ? {
        mode: 'edit',
        kind: event.kind,
        event,
        occurredAt: new Date(event.occurredAt),
        diaperType: event.data.diaperType,
      }
    : {
        mode: 'edit',
        kind: event.kind,
        event,
        occurredAt: new Date(event.occurredAt),
        note: event.data.note,
      };
}

/** Validates UI-only draft requirements without transforming user-entered Medicine text. */
export function careEventDraftError(
  draft: CareEventDrawerState,
  now: Date = new Date(),
): string | null {
  if (Number.isNaN(draft.occurredAt.getTime())) return 'Enter a valid date and time.';
  if (draft.occurredAt.getTime() > now.getTime()) {
    return 'Care event time cannot be in the future.';
  }
  if (draft.kind === 'diaper' && draft.diaperType === null) {
    return 'Choose Dry, Wet, Dirty, or Mixed.';
  }
  if (draft.kind === 'medicine' && draft.note.trim().length === 0) {
    return 'Enter a Medicine note.';
  }
  return null;
}

export function updateCareEventOccurredAt(
  draft: CareEventDrawerState,
  occurredAt: Date,
): CareEventDrawerState {
  return { ...draft, occurredAt };
}

export function selectDiaperType(
  draft: Extract<CareEventDrawerState, { kind: 'diaper' }>,
  diaperType: DiaperType,
): Extract<CareEventDrawerState, { kind: 'diaper' }> {
  return { ...draft, diaperType };
}

export function updateMedicineNote(
  draft: Extract<CareEventDrawerState, { kind: 'medicine' }>,
  note: string,
): Extract<CareEventDrawerState, { kind: 'medicine' }> {
  return { ...draft, note };
}
