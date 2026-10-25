import { expect, it } from 'vitest';
import type { SleepActivity } from './contracts';
import { napProgress } from './nap-progress';
const now = new Date('2026-10-19T13:26:00.000Z');
const nap: SleepActivity = {
  id: 'running',
  revision: 'v1',
  kind: 'nap',
  startedAt: '2026-10-19T13:00:00.000Z',
  endedAt: null,
  measuredAt: now.toISOString(),
  status: 'active',
  pauseSeconds: 0,
};
const sample = (id: string, minutes: number, offset = 0): SleepActivity => ({
  ...nap,
  id,
  status: 'completed',
  startedAt: new Date(now.getTime() - (200 + offset) * 60000).toISOString(),
  endedAt: new Date(now.getTime() - (200 + offset - minutes) * 60000).toISOString(),
});
it('uses active durations from preceding naps without mutating source records', () => {
  const records = [sample('first', 60), { ...sample('second', 80), pauseSeconds: 600 }];
  const original = JSON.stringify(records);
  const progress = napProgress(nap, records, now);
  expect(progress.fraction).toBeCloseTo(26 / 65);
  expect(progress.remainingLabel).toBe('~39m');
  expect(progress.estimateLabel).toContain('2 recent completed naps');
  expect(JSON.stringify(records)).toBe(original);
});
it('excludes running, future, invalid and non-nap records; uses an explicit fallback', () => {
  const records: SleepActivity[] = [
    nap,
    { ...sample('waking', 80), kind: 'night-waking' },
    { ...sample('open', 60), endedAt: null },
    { ...sample('bad', 60), pauseSeconds: 4000 },
    { ...sample('nan', 60), pauseSeconds: Number.NaN },
    sample('future', 60, -500),
  ];
  expect(napProgress(nap, records, now)).toMatchObject({
    remainingLabel: '~34m',
    estimateLabel: expect.stringContaining('60 minute fallback'),
  });
});
it('uses only the seven most recent completed naps, independent of ordering', () => {
  const records = Array.from({ length: 7 }, (_, i) => sample(`recent-${i}`, 60, i * 100));
  records.unshift(sample('old', 180, 1000));
  expect(napProgress(nap, records.reverse(), now).fraction).toBeCloseTo(26 / 60);
});
it('freezes progress during pause and excludes accumulated pause time after resume', () => {
  const paused = { ...nap, status: 'paused' as const, pauseSeconds: 360 };
  const later = new Date(now.getTime() + 10 * 60000);
  expect(napProgress(paused, [], now)).toEqual(napProgress(paused, [], later));
  const resumed = { ...nap, pauseSeconds: 960 };
  expect(napProgress(resumed, [], later).fraction).toBeCloseTo(20 / 60);
});
it('clamps overdue progress and does not show negative remaining time', () => {
  expect(napProgress(nap, [], new Date('2026-10-19T15:00:00Z'))).toMatchObject({
    fraction: 1,
    remainingLabel: 'Over est.',
  });
  expect(napProgress(nap, [], new Date('2026-10-19T12:00:00Z')).fraction).toBe(0);
});
