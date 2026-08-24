import { describe, expect, it } from 'vitest';
import {
  assertValidCareEvent,
  type CareEvent,
  type CareEventMutation,
  createDiaperEvent,
  createMedicineEvent,
  deleteCareEvent,
  editCareEvent,
  restoreCareEvent,
} from './care-event';
import type { MutationContext } from './types';

describe('CareEvent', () => {
  it('keeps event and operation subtypes correlated at compile time', () => {
    const medicine = createMedicineEvent('private', context('2026-08-15T12:00:00.000Z'));
    expect(medicine satisfies CareEventMutation).toBe(medicine);

    // @ts-expect-error A Medicine event cannot be paired with a Diaper operation payload.
    const mismatched: CareEventMutation = {
      event: medicine.event,
      operation: {
        operationId: 'operation',
        entityId: medicine.event.id,
        entityType: 'care_event',
        action: 'edit_care_event',
        baseVersion: 1,
        clientOccurredAt: '2026-08-15T12:01:00.000Z',
        clientTimezone: 'Europe/Lisbon',
        payload: {
          kind: 'diaper',
          occurredAt: medicine.event.occurredAt,
          data: { diaperType: 'wet' },
        },
      },
    };
    expect(mismatched.event.kind).toBe('medicine');
  });

  it.each(['dry', 'wet', 'dirty', 'mixed'] as const)(
    'creates a versioned %s diaper point event',
    (diaperType) => {
      const created = createDiaperEvent(
        diaperType,
        context('2026-08-15T12:00:00.500Z'),
        new Date('2026-08-15T11:59:00.125Z'),
      );

      expect(created.event).toEqual({
        id: '2026-08-15T12:00:00.500Z-id-0',
        childId: 'child-arthur',
        kind: 'diaper',
        occurredAt: '2026-08-15T11:59:00.125Z',
        data: { diaperType },
        timezone: 'Europe/Lisbon',
        createdBy: 'caregiver-paloma',
        updatedBy: 'caregiver-paloma',
        version: 1,
        deletedAt: null,
      });
      expect(created.operation).toEqual({
        operationId: '2026-08-15T12:00:00.500Z-id-1',
        entityId: created.event.id,
        entityType: 'care_event',
        action: 'create_care_event',
        baseVersion: null,
        clientOccurredAt: '2026-08-15T12:00:00.500Z',
        clientTimezone: 'Europe/Lisbon',
        payload: {
          kind: 'diaper',
          occurredAt: '2026-08-15T11:59:00.125Z',
          data: { diaperType },
        },
      });
    },
  );

  it('preserves medicine input exactly while validating only trimmed emptiness', () => {
    const note = '  Paracetamol 2.5 ml — given after food  ';
    const created = createMedicineEvent(note, context('2026-08-15T12:00:00.000Z'));

    expect(created.event.data.note).toBe(note);
    expect(created.operation.payload).toMatchObject({ data: { note } });
    expect(() => createMedicineEvent(' \n\t ', context('2026-08-15T12:00:00.000Z'))).toThrow(
      'A medicine event requires a non-empty note.',
    );
  });

  it('edits the exact stable event, including timestamp and kind-specific data', () => {
    const created = createDiaperEvent('wet', context('2026-08-15T12:00:00.000Z')).event;
    const edited = editCareEvent(
      created,
      { occurredAt: new Date('2026-08-15T11:58:00.250Z'), data: { diaperType: 'mixed' } },
      context('2026-08-15T12:01:00.000Z'),
    );

    expect(edited.event).toMatchObject({
      id: created.id,
      kind: 'diaper',
      occurredAt: '2026-08-15T11:58:00.250Z',
      data: { diaperType: 'mixed' },
      version: 2,
    });
    expect(edited.operation).toMatchObject({
      entityId: created.id,
      action: 'edit_care_event',
      baseVersion: 1,
    });
  });

  it('deletes and restores the same identifier as optimistic tombstones', () => {
    const created = createMedicineEvent('kept private', context('2026-08-15T12:00:00.000Z')).event;
    const deleted = deleteCareEvent(created, context('2026-08-15T12:01:00.000Z'));
    const restored = restoreCareEvent(deleted.event, context('2026-08-15T12:02:00.000Z'));

    expect(deleted.event).toMatchObject({
      id: created.id,
      version: 2,
      deletedAt: '2026-08-15T12:01:00.000Z',
    });
    expect(restored.event).toMatchObject({ id: created.id, version: 3, deletedAt: null });
    expect(restored.operation).toMatchObject({
      action: 'restore_care_event',
      baseVersion: 2,
      payload: {},
    });
  });

  it('rejects future occurrence corrections and invalid tombstone transitions', () => {
    const created = createDiaperEvent('dry', context('2026-08-15T12:00:00.000Z')).event;
    expect(() =>
      createDiaperEvent(
        'dry',
        context('2026-08-15T12:00:00.000Z'),
        new Date('2026-08-15T12:00:00.001Z'),
      ),
    ).toThrow('A care event cannot occur in the future.');
    expect(() =>
      editCareEvent(
        created,
        { occurredAt: new Date('2026-08-15T12:01:00.000Z'), data: { diaperType: 'wet' } },
        context('2026-08-15T12:00:59.999Z'),
      ),
    ).toThrow('A care event cannot occur in the future.');
    expect(() => restoreCareEvent(created, context('2026-08-15T12:01:00.000Z'))).toThrow(
      'Only a deleted care event can be restored.',
    );
    const deleted = deleteCareEvent(created, context('2026-08-15T12:01:00.000Z')).event;
    expect(() => deleteCareEvent(deleted, context('2026-08-15T12:02:00.000Z'))).toThrow(
      'This care event is already deleted.',
    );
    expect(() =>
      editCareEvent(
        deleted,
        { occurredAt: new Date(deleted.occurredAt), data: { diaperType: 'mixed' } },
        context('2026-08-15T12:02:00.000Z'),
      ),
    ).toThrow('A deleted care event cannot be edited.');
  });

  it('runtime-validates discriminated JSON, canonical instants, ownership, versions, and timezone', () => {
    const valid = createMedicineEvent('private note', context('2026-08-15T12:00:00.000Z')).event;
    const invalid: unknown[] = [
      null,
      { ...valid, id: '' },
      { ...valid, kind: 'bath' },
      { ...valid, data: { note: '' } },
      { ...valid, data: { note: 'ok', dose: 'not supported' } },
      { ...valid, occurredAt: '2026-02-30T12:00:00.000Z' },
      { ...valid, version: 1.5 },
      { ...valid, timezone: 'Not/A_Timezone' },
      { ...valid, deletedAt: 'not-an-instant' },
      { ...valid, deletedAt: '2026-08-15T11:59:59.999Z' },
      {
        ...createDiaperEvent('wet', context('2026-08-15T12:00:00.000Z')).event,
        data: { diaperType: 'damp' },
      },
    ];

    for (const event of invalid) expect(() => assertValidCareEvent(event)).toThrow();
  });

  it('never includes medicine text in validation or transition errors', () => {
    const secret = 'Secret medicine 123 ml';
    const invalid = {
      ...createMedicineEvent(secret, context('2026-08-15T12:00:00.000Z')).event,
      version: 0,
    } satisfies CareEvent;

    let message = '';
    try {
      assertValidCareEvent(invalid);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain(secret);
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
