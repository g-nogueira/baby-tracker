import { expect, it } from 'vitest';
import { careCycleViews } from '@/features/care-service/cycle-view';
import type { CareActivity } from '@/features/care-service/contracts';
import { homeCycleView } from './home-cycle-view';
const bed = (startedAt: string): CareActivity => ({
  id: 'bed',
  revision: 'v1',
  kind: 'bedtime',
  startedAt,
  endedAt: startedAt,
  status: 'completed',
});
const night = (start: string, now: string, zone = 'Europe/Lisbon') =>
  careCycleViews([bed(start)], now.slice(0, 10), zone, new Date(now), true).night;
it.each([
  ['2026-10-18T18:55:00.000Z', '2026-10-19T00:20:00.000Z', '2026-10-19T06:00:00.000Z'],
  ['2026-10-24T18:55:00.000Z', '2026-10-25T02:20:00.000Z', '2026-10-25T07:00:00.000Z'],
  ['2026-03-28T19:55:00.000Z', '2026-03-29T02:20:00.000Z', '2026-03-29T06:00:00.000Z'],
])('estimates local 07:00 across midnight and Lisbon DST (%s)', (start, now, expected) => {
  const original = night(start, now),
    view = homeCycleView(original);
  expect(view.estimatedWakeUp).toMatchObject({ at: expected, source: 'fixed-7am' });
  expect(view.projection?.cycle).toEqual(original.projection?.cycle);
  expect(view.projection?.cycle.endedAt).toBeNull();
  expect(view.projection?.anchors).toHaveLength(1);
  expect(view.records.map((r) => r.id)).toEqual(original.records.map((r) => r.id));
  expect(original.estimatedWakeUp).toBeUndefined();
});
it('keeps an overdue estimate on the same morning and clamps progress without rolling it to tomorrow', () => {
  const view = homeCycleView(night('2026-10-18T18:55:00.000Z', '2026-10-19T08:00:00.000Z'));
  expect(view.estimatedWakeUp?.at).toBe('2026-10-19T06:00:00.000Z');
  expect(view.nightProgress?.endAngle).toBe(503);
  expect(view.estimatedWakeUp?.angleDegrees).toBeLessThan(view.nightProgress?.endAngle ?? 0);
});
it('never adds a forecast to a completed night or a Day cycle', () => {
  const startedAt = '2026-10-18T18:55:00.000Z',
    endedAt = '2026-10-19T04:30:00.000Z';
  const wake: CareActivity = {
    id: 'wake',
    revision: 'v1',
    kind: 'wake-up',
    startedAt: endedAt,
    endedAt,
    status: 'completed',
  };
  const views = careCycleViews(
    [bed(startedAt), wake],
    '2026-10-19',
    'Europe/Lisbon',
    new Date('2026-10-19T06:15:00.000Z'),
    false,
  );
  expect(homeCycleView(views.night).estimatedWakeUp).toBeUndefined();
  expect(homeCycleView(views.day).estimatedWakeUp).toBeUndefined();
  expect(homeCycleView(views.day).projection?.anchors[0].recordId).toBe('wake');
});
it('keeps late events distinct across the full day when no Wake-up is available', () => {
  const records: CareActivity[] = ['16', '20'].map((hour) => ({
    id: `diaper-${hour}`,
    revision: 'v1',
    kind: 'diaper',
    diaperType: 'wet',
    status: 'completed',
    startedAt: `2026-10-19T${hour}:00:00.000Z`,
    endedAt: `2026-10-19T${hour}:00:00.000Z`,
  }));
  const view = homeCycleView(
    careCycleViews(records, '2026-10-19', 'UTC', new Date('2026-10-19T21:00:00Z'), true).day,
  );
  expect(view.projection?.cycle.kind).toBe('unanchored_day');
  expect(view.records[0].projection.token?.projection.angleDegrees).toBeLessThan(
    view.records[1].projection.token?.projection.angleDegrees ?? 0,
  );
  expect(view.estimatedWakeUp).toBeUndefined();
});
