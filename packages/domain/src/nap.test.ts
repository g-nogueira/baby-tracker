import { describe, expect, it } from 'vitest';

import { deleteNap, startNap, stopNap } from './nap';
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
    });
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

  it('refuses an end before the nap start', () => {
    const active = startNap(context('2026-08-08T12:10:00.000Z')).session;

    expect(() => stopNap(active, context('2026-08-08T12:09:59.000Z'))).toThrow(
      'A nap cannot end before it starts.',
    );
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
