import { expect, it } from 'vitest';
import { CYCLE_START_ANGLE_DEGREES, CYCLE_SWEEP_ANGLE_DEGREES } from '@baby-tracker/domain';
import type { CareActivity, PointActivity, SleepActivity } from './contracts';
import { careCycleViews } from './cycle-view';
const point = (kind: 'bedtime' | 'wake-up', at: string, id: string = kind): PointActivity => ({
  id,
  revision: `${id}-v1`,
  kind,
  startedAt: at,
  endedAt: at,
  status: 'completed',
});
const bed = point('bedtime', '2026-10-14T19:05:00.000Z');
const wake = point('wake-up', '2026-10-15T06:30:00.000Z');
const waking: SleepActivity = {
  id: 'waking',
  revision: 'waking-v1',
  kind: 'night-waking',
  startedAt: '2026-10-15T00:10:00.000Z',
  endedAt: '2026-10-15T00:15:00.000Z',
  status: 'completed',
  pauseSeconds: 0,
};
it('keeps an active night anchored across midnight and projects concurrent care in the same cycle', () => {
  const feed: CareActivity = {
    id: 'feed',
    revision: 'feed-v1',
    kind: 'nursing',
    measuredAt: '2026-10-15T00:11:00.000Z',
    startedAt: '2026-10-15T00:11:00.000Z',
    endedAt: null,
    status: 'active',
    leftSeconds: 0,
    rightSeconds: 0,
    lastBreast: 'LEFT',
    pauseSeconds: 0,
  };
  const now = new Date('2026-10-15T00:13:00.000Z');
  const views = careCycleViews(
    [bed, { ...waking, endedAt: null, status: 'active' }, feed],
    '2026-10-15',
    'Europe/Lisbon',
    now,
    true,
  );
  expect(views.night.projection?.cycle.startedAt).toBe(bed.startedAt);
  expect(views.night.records.map((r) => r.id).sort()).toEqual([bed.id, feed.id, waking.id].sort());
  expect(views.night.records.find((r) => r.id === feed.id)?.projection.arc?.actualDurationMs).toBe(
    120000,
  );
  expect(views.night.ticks.some((t) => t.label === 'Midnight')).toBe(true);
});
it('fits a completed night to real Bedtime → Wake up and preserves distinct editable anchor IDs', () => {
  const views = careCycleViews(
    [bed, wake, waking],
    '2026-10-14',
    'Europe/Lisbon',
    new Date('2026-10-16T12:00:00.000Z'),
    false,
  );
  expect(views.night.projection?.cycle.startedAt).toBe(bed.startedAt);
  expect(views.night.projection?.cycle.endedAt).toBe(wake.startedAt);
  expect(views.night.projection?.anchors.map((a) => a.recordId)).toEqual([bed.id, wake.id]);
  expect(views.night.projection?.anchors.at(-1)?.projection.angleDegrees).toBe(
    CYCLE_START_ANGLE_DEGREES + CYCLE_SWEEP_ANGLE_DEGREES,
  );
  const record = views.night.records.find((r) => r.id === waking.id);
  expect(record?.occurredAt).toBe(waking.startedAt);
  expect(record?.projection.arc?.actualDurationMs).toBe(300000);
});
it('anchors Day at the shared morning wake-up and excludes the following night', () => {
  const nextBed = point('bedtime', '2026-10-15T19:00:00.000Z', 'next-bed');
  const nap: SleepActivity = {
    ...waking,
    id: 'nap',
    kind: 'nap',
    startedAt: '2026-10-15T09:00:00.000Z',
    endedAt: '2026-10-15T09:30:00.000Z',
  };
  const nextWaking: SleepActivity = {
    ...waking,
    id: 'next-waking',
    startedAt: '2026-10-15T22:00:00.000Z',
    endedAt: '2026-10-15T22:05:00.000Z',
  };
  const views = careCycleViews(
    [bed, wake, waking, nextBed, nap, nextWaking],
    '2026-10-15',
    'Europe/Lisbon',
    new Date('2026-10-16T12:00:00.000Z'),
    false,
  );
  expect(views.day.projection?.cycle.startedAt).toBe(wake.startedAt);
  expect(views.day.projection?.cycle.endedAt).toBe(nextBed.startedAt);
  expect(views.day.records.map((r) => r.id)).toEqual(['nap']);
  expect(views.day.projection?.anchors.map((a) => a.recordId)).toEqual([wake.id, nextBed.id]);
});
it('keeps an unanchored day visible without inventing a bedtime or wake-up', () => {
  const views = careCycleViews(
    [],
    '2026-10-15',
    'Europe/Lisbon',
    new Date('2026-10-15T12:00:00.000Z'),
    true,
  );
  expect(views.day.projection?.cycle.kind).toBe('unanchored_day');
  expect(views.night.projection).toBeNull();
});
