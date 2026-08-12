import { describe, expect, it } from 'vitest';

import { deleteNap, editNap, restoreNap, startNap, stopNap } from './nap';
import { elapsedMilliseconds } from './time';
import type { MutationContext } from './types';
import { createUuidV7 } from './uuid-v7';

function context(at: string): MutationContext {
  let sequence = 0;
  return {
    caregiverId: 'caregiver-paloma',
    childId: 'child-arthur',
    now: new Date(at),
    timezone: 'Europe/Lisbon',
    newId: () => `id-${sequence++}`,
  };
}

describe('nap lifecycle', () => {
  it('creates one active asleep phase and an idempotent outbox operation', () => {
    const result = startNap(context('2026-08-08T12:10:00.000Z'));

    expect(result.session).toMatchObject({
      id: 'id-0',
      kind: 'nap',
      status: 'active',
      startedAt: '2026-08-08T12:10:00.000Z',
      endedAt: null,
      version: 1,
      phase: {
        id: 'id-1',
        kind: 'asleep',
        endedAt: null,
        createdBy: 'caregiver-paloma',
        updatedBy: 'caregiver-paloma',
      },
    });
    expect(result.operation).toMatchObject({
      operationId: 'id-2',
      action: 'start_nap',
      baseVersion: null,
      clientOccurredAt: '2026-08-08T12:10:00.000Z',
      payload: { startedAt: '2026-08-08T12:10:00.000Z' },
    });
  });

  it('keeps a corrected start separate from when the operation occurred', () => {
    const result = startNap(
      context('2026-08-08T12:10:00.000Z'),
      new Date('2026-08-08T12:02:00.000Z'),
    );

    expect(result.session.startedAt).toBe('2026-08-08T12:02:00.000Z');
    expect(result.operation).toMatchObject({
      clientOccurredAt: '2026-08-08T12:10:00.000Z',
      payload: { startedAt: '2026-08-08T12:02:00.000Z' },
    });
  });

  it('refuses nap boundaries in the future', () => {
    expect(() =>
      startNap(context('2026-08-08T12:10:00.000Z'), new Date('2026-08-08T12:11:00.000Z')),
    ).toThrow('A nap time cannot be in the future.');

    const active = startNap(context('2026-08-08T12:10:00.000Z')).session;
    expect(() =>
      stopNap(active, context('2026-08-08T12:20:00.000Z'), new Date('2026-08-08T12:21:00.000Z')),
    ).toThrow('A nap time cannot be in the future.');
  });

  it('stops the session and phase at the same instant', () => {
    const active = startNap(context('2026-08-08T12:10:00.000Z')).session;
    const stopped = stopNap(active, context('2026-08-08T12:42:00.000Z'));

    expect(stopped.session).toMatchObject({
      status: 'completed',
      endedAt: '2026-08-08T12:42:00.000Z',
      version: 2,
      phase: { endedAt: '2026-08-08T12:42:00.000Z', version: 2 },
    });
    expect(stopped.operation.baseVersion).toBe(1);
  });

  it('keeps a corrected end separate from when the operation occurred', () => {
    const active = startNap(context('2026-08-08T12:10:00.000Z')).session;
    const stopped = stopNap(
      active,
      context('2026-08-08T12:50:00.000Z'),
      new Date('2026-08-08T12:42:00.000Z'),
    );

    expect(stopped.session.endedAt).toBe('2026-08-08T12:42:00.000Z');
    expect(stopped.operation).toMatchObject({
      clientOccurredAt: '2026-08-08T12:50:00.000Z',
      payload: { endedAt: '2026-08-08T12:42:00.000Z' },
    });
  });

  it('requires an end strictly after the nap start', () => {
    const active = startNap(context('2026-08-08T12:10:00.000Z')).session;

    expect(() => stopNap(active, context('2026-08-08T12:09:59.000Z'))).toThrow(
      'A nap must end after it starts.',
    );
    expect(() => stopNap(active, context('2026-08-08T12:10:00.000Z'))).toThrow(
      'A nap must end after it starts.',
    );
  });

  it('accepts a completed nap that crosses midnight', () => {
    const active = startNap(context('2026-08-08T23:50:00.000Z')).session;
    const stopped = stopNap(active, context('2026-08-09T00:20:00.000Z'));

    expect(stopped.session).toMatchObject({
      startedAt: '2026-08-08T23:50:00.000Z',
      endedAt: '2026-08-09T00:20:00.000Z',
      status: 'completed',
    });
  });

  it('refuses to stop a completed nap', () => {
    const active = startNap(context('2026-08-08T12:10:00.000Z')).session;
    const completed = stopNap(active, context('2026-08-08T12:42:00.000Z')).session;

    expect(() => stopNap(completed, context('2026-08-08T12:43:00.000Z'))).toThrow(
      'Only an active nap can be stopped.',
    );
  });

  it('refuses lifecycle changes after deletion', () => {
    const active = startNap(context('2026-08-08T12:10:00.000Z')).session;
    const deleted = deleteNap(active, context('2026-08-08T12:11:00.000Z')).session;

    expect(() => stopNap(deleted, context('2026-08-08T12:12:00.000Z'))).toThrow(
      'A deleted nap cannot be changed.',
    );
    expect(() => deleteNap(deleted, context('2026-08-08T12:12:00.000Z'))).toThrow(
      'This nap is already deleted.',
    );
  });

  it('turns a deletion into a versioned tombstone', () => {
    const active = startNap(context('2026-08-08T12:10:00.000Z')).session;
    const deleted = deleteNap(active, context('2026-08-08T12:11:00.000Z'));

    expect(deleted.session.deletedAt).toBe('2026-08-08T12:11:00.000Z');
    expect(deleted.session.phase.deletedAt).toBe('2026-08-08T12:11:00.000Z');
    expect(deleted.operation).toMatchObject({
      action: 'delete_sleep_session',
      baseVersion: 1,
    });
  });

  it('edits session and phase boundaries with optimistic versioning', () => {
    const active = startNap(context('2026-08-08T12:10:00.000Z')).session;
    const completed = stopNap(active, context('2026-08-08T12:42:00.000Z')).session;
    const edited = editNap(
      completed,
      new Date('2026-08-08T12:05:00.000Z'),
      new Date('2026-08-08T12:47:00.000Z'),
      context('2026-08-08T12:50:00.000Z'),
    );

    expect(edited.session).toMatchObject({
      id: completed.id,
      startedAt: '2026-08-08T12:05:00.000Z',
      endedAt: '2026-08-08T12:47:00.000Z',
      version: 3,
      phase: {
        startedAt: '2026-08-08T12:05:00.000Z',
        endedAt: '2026-08-08T12:47:00.000Z',
        version: 3,
      },
    });
    expect(edited.operation).toMatchObject({
      entityId: completed.id,
      action: 'edit_sleep_session',
      baseVersion: 2,
      payload: {
        startedAt: '2026-08-08T12:05:00.000Z',
        endedAt: '2026-08-08T12:47:00.000Z',
      },
    });
  });

  it('allows an active nap start to be corrected without adding an end', () => {
    const active = startNap(context('2026-08-08T12:10:00.000Z')).session;
    const edited = editNap(
      active,
      new Date('2026-08-08T12:05:00.000Z'),
      null,
      context('2026-08-08T12:11:00.000Z'),
    );

    expect(edited.session).toMatchObject({
      status: 'active',
      startedAt: '2026-08-08T12:05:00.000Z',
      endedAt: null,
      phase: { startedAt: '2026-08-08T12:05:00.000Z', endedAt: null },
    });
  });

  it('rejects edits that do not match the nap lifecycle', () => {
    const active = startNap(context('2026-08-08T12:10:00.000Z')).session;
    const completed = stopNap(active, context('2026-08-08T12:42:00.000Z')).session;

    expect(() =>
      editNap(
        active,
        new Date('2026-08-08T12:10:00.000Z'),
        new Date('2026-08-08T12:42:00.000Z'),
        context('2026-08-08T12:43:00.000Z'),
      ),
    ).toThrow('An active nap cannot have an end time.');
    expect(() =>
      editNap(
        completed,
        new Date('2026-08-08T12:10:00.000Z'),
        null,
        context('2026-08-08T12:43:00.000Z'),
      ),
    ).toThrow('A completed nap requires an end time.');
  });

  it('restores a deleted nap with the same stable identifiers', () => {
    const active = startNap(context('2026-08-08T12:10:00.000Z')).session;
    const completed = stopNap(active, context('2026-08-08T12:42:00.000Z')).session;
    const deleted = deleteNap(completed, context('2026-08-08T12:45:00.000Z')).session;
    const restored = restoreNap(deleted, context('2026-08-08T12:46:00.000Z'));

    expect(restored.session).toMatchObject({
      id: completed.id,
      version: 4,
      deletedAt: null,
      phase: { id: completed.phase.id, version: 4, deletedAt: null },
    });
    expect(restored.operation).toMatchObject({
      entityId: completed.id,
      action: 'restore_sleep_session',
      baseVersion: 3,
    });
  });
});

describe('elapsed time', () => {
  it('rejects invalid date-time boundaries', () => {
    expect(() => elapsedMilliseconds('not-a-date', new Date())).toThrow(
      'Valid elapsed-time boundaries are required.',
    );
  });
});

describe('UUIDv7', () => {
  it('encodes sortable time, version, and RFC variant', () => {
    const first = createUuidV7(1_700_000_000_000, (bytes) => bytes.fill(0));
    const second = createUuidV7(1_700_000_000_001, (bytes) => bytes.fill(0));

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first < second).toBe(true);
  });
});
