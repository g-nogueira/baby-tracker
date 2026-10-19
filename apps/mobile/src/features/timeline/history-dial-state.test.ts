import { expect, it } from 'vitest';
import { homeCycleView } from './home-cycle-view';
import { careCycleViews } from '@/features/care-service/cycle-view';
import type { CareActivity, NursingActivity } from '@/features/care-service/contracts';
import {
  HISTORY_START_ANGLE,
  HISTORY_SWEEP_ANGLE,
  historyDialGroups,
  historyDialView,
} from './history-dial-state';

const at = (time: string) => `2026-10-18T${time}:00.000Z`;
const wake: CareActivity = {
  id: 'wake',
  revision: 'v1',
  kind: 'wake-up',
  startedAt: at('05:57'),
  endedAt: at('05:57'),
  status: 'completed',
};
const bed: CareActivity = {
  id: 'bed',
  revision: 'v1',
  kind: 'bedtime',
  startedAt: at('18:45'),
  endedAt: at('18:55'),
  status: 'completed',
};
const feed = (id: string, start: string, end: string): NursingActivity => ({
  id,
  revision: 'v1',
  kind: 'nursing',
  startedAt: at(start),
  endedAt: at(end),
  status: 'completed',
  leftSeconds: 0,
  rightSeconds: 480,
  lastBreast: 'RIGHT',
  pauseSeconds: 0,
  measuredAt: at('20:00'),
});
const history = (records: CareActivity[]) =>
  historyDialView(
    careCycleViews(
      [wake, bed, ...records],
      '2026-10-18',
      'Europe/Lisbon',
      new Date(at('21:00')),
      false,
    ).day,
  );
it('reframes history without changing authoritative bounds, interval duration or exact editor IDs', () => {
  const original = careCycleViews(
    [wake, bed, feed('morning', '05:57', '06:05')],
    '2026-10-18',
    'Europe/Lisbon',
    new Date(at('21:00')),
    false,
  ).day;
  const view = historyDialView(original);
  expect(view.projection?.cycle).toEqual(original.projection?.cycle);
  expect(view.projection?.anchors.map((a) => a.projection.angleDegrees)).toEqual([
    HISTORY_START_ANGLE,
    HISTORY_START_ANGLE + HISTORY_SWEEP_ANGLE,
  ]);
  expect(view.records[0].projection.arc?.actualDurationMs).toBe(
    original.records[0].projection.arc?.actualDurationMs,
  );
  expect(view.records[0].editorRecordId).toBe('morning');
  expect(original.projection?.anchors[0].projection.angleDegrees).toBe(225);
});
it('groups the wake boundary with a simultaneous feed but keeps a nearby evening feed separate from Bedtime', () => {
  const groups = historyDialGroups(
    history([feed('morning', '05:57', '06:05'), feed('evening', '18:15', '18:25')]),
    358,
  );
  expect(groups[0].map((t) => t.record?.editorRecordId ?? t.anchor?.recordId).sort()).toEqual([
    'morning',
    'wake',
  ]);
  expect(groups.at(-2)?.map((t) => t.record?.id)).toEqual(['evening']);
  expect(groups.at(-1)?.[0].anchor?.recordId).toBe('bed');
});
it('places the small Nap symbol inside its duration band while retaining the actual start for editing', () => {
  const view = history([
    {
      id: 'nap',
      revision: 'v1',
      kind: 'nap',
      startedAt: at('09:40'),
      endedAt: at('10:45'),
      status: 'completed',
      pauseSeconds: 0,
      measuredAt: at('21:00'),
    },
  ]);
  const target = historyDialGroups(view, 358)
    .flat()
    .find((t) => t.record?.id === 'nap');
  const arc = target?.record?.projection.arc;
  expect(target?.angle).toBe(((arc?.start.angleDegrees ?? 0) + (arc?.end.angleDegrees ?? 0)) / 2);
  expect(target?.record?.occurredAt).toBe(at('09:40'));
});

it('keeps a diaper and feed 23 minutes apart individually visible on Home without moving either time', () => {
  const view = homeCycleView(
    careCycleViews(
      [
        wake,
        {
          id: 'diaper',
          revision: 'v1',
          kind: 'diaper',
          diaperType: 'wet',
          startedAt: at('07:53'),
          endedAt: at('07:53'),
          status: 'completed',
        },
        feed('feeding', '08:16', '08:26'),
      ],
      '2026-10-18',
      'Europe/Lisbon',
      new Date(at('08:27')),
      false,
    ).day,
  );
  for (const size of [358, 414]) {
    const targets = historyDialGroups(view, size, 'start');
    expect(
      targets.map((group) => group.map((target) => target.record?.id ?? target.anchor?.recordId)),
    ).toEqual([['wake'], ['diaper'], ['feeding']]);
    for (const record of view.records) {
      const target = targets.flat().find((target) => target.record?.id === record.id);
      expect(target?.angle).toBe(
        record.projection.token?.projection.angleDegrees ??
          record.projection.arc?.start.angleDegrees,
      );
      expect(target?.record?.occurredAt).toBe(record.occurredAt);
    }
  }
});
it('still offers exact record selection for a tightly overlapping diaper and feed', () => {
  const groups = historyDialGroups(
    history([
      {
        id: 'diaper',
        revision: 'v1',
        kind: 'diaper',
        diaperType: 'wet',
        startedAt: at('14:00'),
        endedAt: at('14:00'),
        status: 'completed',
      },
      feed('feeding', '14:05', '14:17'),
    ]),
    358,
  );
  expect(
    groups
      .find((group) => group.some((target) => target.id === 'diaper'))
      ?.map((target) => target.id),
  ).toEqual(['diaper', 'feeding']);
});
