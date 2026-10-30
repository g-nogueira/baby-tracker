import { expect, it } from 'vitest';
import { activityDuration, sleepSegmentDuration } from './sleep-state';
import type { SleepActivity } from './contracts';
it('separates accumulated sleep from the current phase across pause/resume and DST', () => {
  const nap: SleepActivity = {
    id: 'nap',
    revision: 'v1',
    kind: 'nap',
    status: 'active',
    startedAt: '2026-10-25T00:30:00.000Z',
    endedAt: null,
    measuredAt: '2026-10-25T01:25:00.000Z',
    pauseSeconds: 2100,
    pauses: [
      { id: 'p', startedAt: '2026-10-25T00:50:00.000Z', endedAt: '2026-10-25T01:25:00.000Z' },
    ],
  };
  const now = new Date('2026-10-25T01:25:23.000Z');
  expect(activityDuration(nap, now)).toBe(20 * 60000 + 23000);
  expect(sleepSegmentDuration(nap, now)).toBe(23000);
  const paused: SleepActivity = {
    ...nap,
    status: 'paused',
    pauseSeconds: 300,
    measuredAt: '2026-10-25T00:55:00.000Z',
    pauses: [{ id: 'p', startedAt: '2026-10-25T00:50:00.000Z', endedAt: null }],
  };
  expect(activityDuration(paused, now)).toBe(20 * 60000);
  expect(sleepSegmentDuration(paused, now)).toBe(35 * 60000 + 23000);
});
