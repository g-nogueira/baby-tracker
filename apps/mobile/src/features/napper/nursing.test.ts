import { describe, expect, it } from 'vitest';
import type { WireLog } from './contracts';
import {
  changeNapperNursing,
  correctNapperNursing,
  nursingTotals,
  readNursing,
  startNapperNursing,
} from './nursing';
export const started = (): WireLog =>
  startNapperNursing(
    'LOG_synthetic_NURSING',
    'LEFT',
    'parent-test',
    new Date('2026-10-13T10:00:00Z'),
    new Date('2026-10-13T12:00:00Z'),
  );
const at = (time: string) => new Date(`2026-10-13T${time}Z`);
describe('Napper Nursing wire semantics', () => {
  it('uses seconds despite wire field names, accrues current side by instants and preserves Last', () => {
    const switched = changeNapperNursing(
      readNursing(started()),
      { kind: 'switch', side: 'RIGHT' },
      at('10:02:00'),
    );
    expect(switched).toMatchObject({
      breastLeftMinutes: 120,
      breastRightMinutes: 0,
      activeBreast: 'RIGHT',
      isOpen: true,
    });
    expect(nursingTotals(readNursing(switched), at('10:03:00'))).toMatchObject({
      left: 120,
      right: 60,
      total: 180,
    });
    const ended = changeNapperNursing(readNursing(switched), { kind: 'stop' }, at('10:03:00'));
    expect(ended.activeBreast).toBe('RIGHT');
    expect(ended.isOpen).toBe(false);
  });
  it('freezes Nursing during a pause and trims a trailing pause when stopping', () => {
    const paused = changeNapperNursing(readNursing(started()), { kind: 'pause' }, at('10:02:00'));
    expect(paused.pauses).toEqual([{ start: at('10:02:00').getTime(), end: null, breast: 'LEFT' }]);
    expect(nursingTotals(readNursing(paused), at('10:05:00'))).toMatchObject({
      total: 120,
      pause: 180,
      paused: true,
    });
    const ended = changeNapperNursing(readNursing(paused), { kind: 'stop' }, at('10:05:00'));
    expect(Date.parse(String(ended.end))).toBe(at('10:02:00').getTime());
    expect(ended.pauses).toEqual([]);
    expect(ended.breastLeftMinutes).toBe(120);
  });
  it('closes numeric pauses and resumes on either breast without counting pause time', () => {
    const paused = changeNapperNursing(readNursing(started()), { kind: 'pause' }, at('10:02:00'));
    const resumed = changeNapperNursing(
      readNursing(paused),
      { kind: 'resume', side: 'RIGHT' },
      at('10:04:00'),
    );
    expect(nursingTotals(readNursing(resumed), at('10:05:00'))).toMatchObject({
      left: 120,
      right: 60,
      total: 180,
      pause: 120,
      paused: false,
    });
  });
  it.each(['LEFT', 'RIGHT'] as const)(
    'reads a stopped feed reopened in Napper on %s, retaining fractional seconds and excluding the gap',
    (side) => {
      const oldPause = {
        start: at('10:00:05.250').getTime(),
        end: at('10:00:06.500').getTime(),
        breast: 'LEFT',
      };
      const gap = {
        start: at('10:00:21.500').getTime(),
        end: at('10:03:00.250').getTime(),
        breast: side,
      };
      // SDK resume: same id/start/totals, end reset to start, gap appended as a pause.
      const reopened: WireLog = {
        ...started(),
        activeBreast: side,
        breastLeftMinutes: side === 'RIGHT' ? 5.75 : 14.5,
        breastRightMinutes: side === 'LEFT' ? 5.75 : 14.5,
        pauses: [oldPause, gap],
        comment: 'synthetic%20note',
      };
      const original = structuredClone(reopened);
      const totals = nursingTotals(readNursing(reopened), at('10:03:10.500'));
      expect(totals).toMatchObject({
        left: side === 'LEFT' ? 25 : 5.75,
        right: side === 'RIGHT' ? 25 : 5.75,
        total: 30.75,
        pause: 160,
        paused: false,
      });
      const paused = changeNapperNursing(
        readNursing(reopened),
        { kind: 'pause' },
        at('10:03:10.500'),
      );
      expect(nursingTotals(readNursing(paused), at('10:04:00')).total).toBe(30.75);
      const resumed = changeNapperNursing(
        readNursing(paused),
        { kind: 'resume', side },
        at('10:04:00'),
      );
      const stopped = changeNapperNursing(readNursing(resumed), { kind: 'stop' }, at('10:04:10'));
      expect(stopped).toMatchObject({
        id: reopened.id,
        comment: reopened.comment,
        isOpen: false,
        activeBreast: side,
        breastLeftMinutes: side === 'LEFT' ? 35 : 5.75,
        breastRightMinutes: side === 'RIGHT' ? 35 : 5.75,
      });
      expect((stopped.pauses as unknown[]).slice(0, 2)).toEqual([oldPause, gap]);
      expect(reopened).toEqual(original);
    },
  );
  it.each([-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '12.5'])(
    'still rejects an invalid breast duration: %s',
    (duration) => {
      expect(() => readNursing({ ...started(), breastLeftMinutes: duration })).toThrow(
        'A breast duration is invalid',
      );
    },
  );
  it('retains comments, ownership and pauses when correcting an interval across midnight', () => {
    const log = {
      ...started(),
      start: '2026-10-12T23:50:00+00:00',
      end: '2026-10-13T00:10:00+00:00',
      isOpen: false,
      breastLeftMinutes: 480,
      breastRightMinutes: 600,
      comment: 'preserve%20this',
      createdByUserId: 'other-parent',
      pauses: [
        {
          start: Date.parse('2026-10-12T23:59:00Z'),
          end: Date.parse('2026-10-13T00:01:00Z'),
          breast: 'LEFT',
        },
      ],
      updatedAt: 'server-only',
    };
    const corrected = correctNapperNursing(
      readNursing(log),
      new Date('2026-10-12T23:45:00Z'),
      new Date('2026-10-13T00:15:00Z'),
      600,
      'RIGHT',
      at('12:00:00'),
    );
    expect(corrected).toMatchObject({
      comment: log.comment,
      createdByUserId: 'other-parent',
      pauses: log.pauses,
      breastLeftMinutes: 600,
      breastRightMinutes: 1080,
      activeBreast: 'RIGHT',
    });
    expect(corrected.updatedAt).toBeUndefined();
    expect(() =>
      correctNapperNursing(
        readNursing(log),
        at('00:02:00'),
        at('00:15:00'),
        300,
        'RIGHT',
        at('12:00:00'),
      ),
    ).toThrow('existing pauses');
  });
  it('does not guess Last from the longer breast, including legacy unknown Last', () => {
    const log = readNursing({
      ...started(),
      isOpen: false,
      activeBreast: 'RIGHT',
      end: '2026-10-13T10:10:00Z',
      breastLeftMinutes: 590,
      breastRightMinutes: 10,
    });
    expect(log.last).toBe('RIGHT');
    expect(readNursing({ ...log.wire, activeBreast: null }).last).toBeNull();
  });
  it('rejects malformed pause ordering, future starts, impossible totals and editing an active feed', () => {
    expect(() =>
      startNapperNursing('LOG_x_NURSING', 'LEFT', 'p', at('12:01:00'), at('12:00:00')),
    ).toThrow();
    expect(() =>
      nursingTotals(readNursing({ ...started(), breastRightMinutes: 500 }), at('10:01:00')),
    ).toThrow();
    expect(() =>
      readNursing({ ...started(), pauses: [{ start: at('09:59:00').getTime(), end: null }] }),
    ).toThrow();
    expect(() =>
      correctNapperNursing(
        readNursing(started()),
        at('10:00:00'),
        at('10:10:00'),
        300,
        'LEFT',
        at('12:00:00'),
      ),
    ).toThrow('Stop this feed');
  });
});
