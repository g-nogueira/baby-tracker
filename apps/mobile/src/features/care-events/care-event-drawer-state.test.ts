import { createDiaperEvent, createMedicineEvent, type MutationContext } from '@baby-tracker/domain';
import { describe, expect, it } from 'vitest';

import {
  careEventDraftError,
  createCareEventDraft,
  editCareEventDraft,
  selectDiaperType,
  updateMedicineNote,
} from './care-event-drawer-state';

describe('CareEvent drawer state', () => {
  it('starts Diaper creation without a default and requires one of the four exact types', () => {
    const draft = createCareEventDraft('diaper', new Date('2026-08-15T12:00:00.000Z'));
    expect(draft).toMatchObject({ kind: 'diaper', mode: 'create', diaperType: null });
    expect(careEventDraftError(draft, new Date('2026-08-15T12:01:00.000Z'))).toBe(
      'Choose Dry, Wet, Dirty, or Mixed.',
    );
    if (draft.kind !== 'diaper') throw new Error('Expected Diaper draft.');
    for (const type of ['dry', 'wet', 'dirty', 'mixed'] as const) {
      expect(
        careEventDraftError(selectDiaperType(draft, type), new Date('2026-08-15T12:01:00.000Z')),
      ).toBeNull();
    }
  });

  it('preserves unrestricted Medicine text exactly while rejecting only trimmed emptiness', () => {
    const draft = createCareEventDraft('medicine', new Date('2026-08-15T12:00:00.000Z'));
    if (draft.kind !== 'medicine') throw new Error('Expected Medicine draft.');
    expect(careEventDraftError(updateMedicineNote(draft, ' \n\t '))).toBe('Enter a Medicine note.');
    const note = '  Paracetamol 2.5 ml\nAfter food  ';
    const updated = updateMedicineNote(draft, note);
    expect(updated.note).toBe(note);
    expect(careEventDraftError(updated, new Date('2026-08-15T12:01:00.000Z'))).toBeNull();
  });

  it('loads the exact persisted subtype, ID, version, timestamp, and Medicine whitespace', () => {
    const diaper = createDiaperEvent('mixed', context('2026-08-15T12:00:00.000Z')).event;
    const note = '  exact private note  ';
    const medicine = createMedicineEvent(note, context('2026-08-15T12:01:00.000Z')).event;

    expect(editCareEventDraft(diaper)).toMatchObject({
      mode: 'edit',
      kind: 'diaper',
      event: { id: diaper.id, version: 1 },
      diaperType: 'mixed',
    });
    expect(editCareEventDraft(medicine)).toMatchObject({
      mode: 'edit',
      kind: 'medicine',
      event: { id: medicine.id, version: 1 },
      note,
    });
  });

  it('rejects invalid or future point-event timestamps', () => {
    const future = createCareEventDraft('diaper', new Date('2026-08-15T12:00:00.001Z'));
    expect(careEventDraftError(future, new Date('2026-08-15T12:00:00.000Z'))).toBe(
      'Care event time cannot be in the future.',
    );
    expect(
      careEventDraftError(
        { ...future, occurredAt: new Date('invalid') },
        new Date('2026-08-15T12:00:00.000Z'),
      ),
    ).toBe('Enter a valid date and time.');
  });
});

function context(at: string): MutationContext {
  let sequence = 0;
  return {
    caregiverId: 'caregiver-paloma',
    childId: 'child-arthur',
    now: new Date(at),
    timezone: 'Europe/Lisbon',
    newId: () => `${at}-id-${sequence++}`,
  };
}
