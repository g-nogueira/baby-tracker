import { deleteNap } from './nap';
import { describe, expect, it } from 'vitest';
import {
  recordCompletedNursing,
  recordCompletedSleep,
  recordNightWaking,
  reopenNap,
} from './historical';
import { assertValidSleepSession } from './sleep';
import type { MutationContext } from './types';
let seq = 0;
const context: MutationContext = {
  childId: 'child',
  caregiverId: 'parent',
  timezone: 'Europe/Lisbon',
  now: new Date('2026-08-17T12:00:00Z'),
  newId: () => `id-${++seq}`,
};
const night = () =>
  recordCompletedSleep(
    'night',
    new Date('2026-08-15T20:00:00Z'),
    new Date('2026-08-16T06:00:00Z'),
    context,
  ).session;
describe('historical activities', () => {
  it.each(['nap', 'night'] as const)(
    'rejects invalid %s bounds without creating an active session',
    (kind) => {
      expect(() =>
        recordCompletedSleep(
          kind,
          new Date('2026-08-17T13:00:00Z'),
          new Date('2026-08-17T14:00:00Z'),
          context,
        ),
      ).toThrow();
      expect(() =>
        recordCompletedSleep(
          kind,
          new Date('2026-08-16T06:00:00Z'),
          new Date('2026-08-15T20:00:00Z'),
          context,
        ),
      ).toThrow();
    },
  );
  it('preserves Night bounds and unrelated phase IDs when adding another waking', () => {
    const original = night();
    if (original.kind !== 'night') throw new Error('Expected Night');
    const first = recordNightWaking(
      original,
      new Date('2026-08-16T00:00:00Z'),
      new Date('2026-08-16T00:10:00Z'),
      context,
    ).session;
    const next = recordNightWaking(
      first,
      new Date('2026-08-16T02:00:00Z'),
      new Date('2026-08-16T02:10:00Z'),
      context,
    ).session;
    expect(next.startedAt).toBe(original.startedAt);
    expect(next.endedAt).toBe(original.endedAt);
    expect(next.status).toBe('completed');
    expect(next.phases.slice(0, 2)).toEqual(first.phases.slice(0, 2));
    assertValidSleepSession(next);
    expect(() =>
      recordNightWaking(
        next,
        new Date('2026-08-16T00:05:00Z'),
        new Date('2026-08-16T00:15:00Z'),
        context,
      ),
    ).toThrow('within one sleeping phase');
  });
  it('rejects continuing an active or deleted Nap', () => {
    const original = recordCompletedSleep(
      'nap',
      new Date('2026-08-16T10:00:00Z'),
      new Date('2026-08-16T10:30:00Z'),
      context,
    ).session;
    if (original.kind !== 'nap') throw new Error('Expected Nap');
    expect(() => reopenNap(deleteNap(original, context).session, context)).toThrow('completed Nap');
    const resumed = reopenNap(original, context).session;
    expect(() => reopenNap(resumed, context)).toThrow('completed Nap');
  });
  it.each([0, 600])('makes Last deterministic for a one-sided historical feed (%s)', (left) => {
    const nursing = recordCompletedNursing(
      new Date('2026-08-16T10:00:00Z'),
      new Date('2026-08-16T10:10:00Z'),
      left,
      'right',
      context,
    ).session;
    expect(nursing.lastBreastUsed).toBe(left === 0 ? 'right' : 'left');
  });
});
