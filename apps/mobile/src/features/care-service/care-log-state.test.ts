import { expect, it } from 'vitest';
import type { CareActivity, PointActivity, SleepActivity, NursingActivity } from './contracts';
import { careLogEntries, careLogWindow } from './care-log-state';
const at = (time: string) => `2026-10-19T${time}:00.000Z`;
const now = new Date(at('20:00'));
const point = (kind: PointActivity['kind'], time: string, id: string = kind): PointActivity => ({
  id,
  revision: 'v1',
  kind,
  startedAt: time,
  endedAt: time,
  status: 'completed',
});
const wake = point('wake-up', at('04:50'));
const bed = point('bedtime', '2026-10-18T18:55:00.000Z');
const nap: SleepActivity = {
  id: 'nap',
  revision: 'v1',
  kind: 'nap',
  startedAt: at('08:26'),
  endedAt: at('08:51'),
  status: 'completed',
  pauseSeconds: 0,
  measuredAt: now.toISOString(),
};
const feed: NursingActivity = {
  id: 'feed',
  revision: 'v1',
  kind: 'nursing',
  startedAt: at('08:16'),
  endedAt: '2026-10-19T08:51:37.000Z',
  status: 'completed',
  leftSeconds: 0,
  rightSeconds: 2137,
  lastBreast: 'RIGHT',
  pauseSeconds: 0,
  measuredAt: now.toISOString(),
};
it('keeps Wake-up first, uses preceding Night context and ignores concurrent care when ending a wake window', () => {
  const visible = [
    nap,
    feed,
    wake,
    { ...point('diaper', at('06:15')), diaperType: 'wet' as const },
  ];
  const entries = careLogEntries(visible, [bed, ...visible], now);
  expect(entries.map((e) => e.activity.id)).toEqual(['wake-up', 'diaper', 'feed', 'nap']);
  expect(entries[0].summary).toEqual({ kind: 'sleep-session', durationMs: (9 * 60 + 55) * 60000 });
  expect(entries[3]).toMatchObject({
    title: 'First nap',
    details: ['25m 00s'],
    summary: { kind: 'wake-window', durationMs: (3 * 60 + 36) * 60000 },
  });
  expect(entries[2].details).toEqual(['35m 37s', '35:37 Right']);
  expect(entries[2].activity).toBe(feed);
  expect(visible[0]).toBe(nap);
});
it('ends the final wake window at actual sleep after the Bedtime routine, independently of Nap pauses', () => {
  const firstNap = {
    ...nap,
    startedAt: at('09:20'),
    endedAt: '2026-10-19T10:52:51.000Z',
    pauseSeconds: 102,
  };
  const routine = { ...point('bedtime', at('18:45'), 'evening'), endedAt: at('18:55') };
  const entries = careLogEntries([wake, firstNap, routine], [bed, wake, firstNap, routine], now);
  expect(entries[1].details).toEqual(['01h 31m']);
  expect(entries[2].activity.endedAt).toBe(at('18:55'));
  expect(entries[2].title).toBe('Fell asleep');
  expect(entries[2].summary?.durationMs).toBe((8 * 3600 + 2 * 60 + 9) * 1000);
  expect(careLogWindow(entries[2].summary?.durationMs ?? 0)).toBe('08h 02m');
});
it('describes the last continuous sleep session before morning, rather than including night wakings', () => {
  const waking: SleepActivity = {
    ...nap,
    id: 'waking',
    kind: 'night-waking',
    startedAt: at('01:00'),
    endedAt: at('01:30'),
  };
  const entries = careLogEntries([wake], [bed, waking, wake], now);
  expect(entries[0].summary).toEqual({ kind: 'sleep-session', durationMs: (3 * 60 + 20) * 60000 });
});
it('does not invent midnight boundaries or claim a preceding phase when context is missing', () => {
  expect(careLogEntries([wake], [wake], now)[0].summary).toBeNull();
  expect(careLogEntries([nap], [nap], now)[0].summary).toBeNull();
});
it('keeps active and paused records open while using measured active time in their details', () => {
  const paused: NursingActivity = {
    ...feed,
    endedAt: null,
    status: 'paused',
    measuredAt: at('09:00'),
    pauseSeconds: 100,
  };
  const active: SleepActivity = { ...nap, status: 'active', endedAt: null };
  const entries = careLogEntries([paused, active], [wake, paused, active], new Date(at('09:01')));
  expect(entries[0].details).toEqual(['35m 37s', '35:37 Right', 'Paused']);
  expect(entries[0].activity.endedAt).toBeNull();
  expect(entries[1].details).toEqual(['35m 00s', 'Running']);
});
it('measures the Lisbon clock rollback in UTC and does not lose the repeated hour', () => {
  const autumnBed = point('bedtime', '2026-10-24T19:55:00.000Z');
  const autumnWake = point('wake-up', '2026-10-25T07:00:00.000Z');
  expect(
    careLogEntries([autumnWake], [autumnBed, autumnWake], new Date('2026-10-25T09:00:00Z'))[0]
      .summary,
  ).toEqual({ kind: 'sleep-session', durationMs: (11 * 60 + 5) * 60000 });
});
it('does not bridge conflicting imported sleep intervals to fabricate a wake-window duration', () => {
  const second = { ...nap, id: 'overlap', startedAt: at('08:40'), endedAt: at('09:10') };
  const routine = point('bedtime', at('18:55'), 'evening');
  const context: CareActivity[] = [bed, wake, nap, second, routine];
  const entries = careLogEntries([nap, second, routine], context, now);
  expect(entries.every((entry) => entry.summary === null)).toBe(true);
});

it('keeps Wake-up before a simultaneous Nursing record regardless of source ID ordering', () => {
  const simultaneous = { ...feed, id: 'aaa-feed', startedAt: wake.startedAt, endedAt: at('05:03') };
  const entries = careLogEntries([simultaneous, wake], [bed, simultaneous, wake], now);
  expect(entries.map((entry) => entry.activity.id)).toEqual([wake.id, simultaneous.id]);
});

it('starts the Day log at Wake-up even when a feed carries over from the preceding Night', () => {
  const carryover = { ...feed, startedAt: at('04:40'), endedAt: at('05:10') };
  const entries = careLogEntries([carryover, wake, nap], [bed, carryover, wake, nap], now);
  expect(entries.map((entry) => entry.activity.id)).toEqual([wake.id, carryover.id, nap.id]);
  expect(entries[1].activity.startedAt).toBe(at('04:40'));
});
it('keeps a Night log ordered from Bedtime to the following morning Wake-up', () => {
  const entries = careLogEntries([wake, bed], [bed, wake], now);
  expect(entries.map((entry) => entry.activity.id)).toEqual([bed.id, wake.id]);
});
