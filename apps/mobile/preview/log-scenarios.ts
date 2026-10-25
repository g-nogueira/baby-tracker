import type {
  CareActivity,
  PointActivity,
  SleepActivity,
  NursingActivity,
} from '../src/features/care-service/contracts';

/** Synthetic Lisbon clock examples; no account records or network requests. */
export function logActivities(date: '2026-10-18' | '2026-10-19'): CareActivity[] {
  const at = (time: string) => `${date}T${time}.000Z`;
  const point = (
    id: string,
    kind: PointActivity['kind'],
    start: string,
    end = start,
  ): PointActivity => ({
    id,
    revision: 'preview-v1',
    kind,
    startedAt: start,
    endedAt: end,
    status: 'completed',
  });
  const feed = (
    id: string,
    start: string,
    end: string,
    seconds: number,
    side: 'LEFT' | 'RIGHT',
  ): NursingActivity => ({
    id,
    revision: 'preview-v1',
    kind: 'nursing',
    startedAt: at(start),
    endedAt: at(end),
    measuredAt: at(end),
    status: 'completed',
    leftSeconds: side === 'LEFT' ? seconds : 0,
    rightSeconds: side === 'RIGHT' ? seconds : 0,
    lastBreast: side,
    pauseSeconds: 0,
  });
  const nap = (start: string, end: string, pauseSeconds = 0): SleepActivity => ({
    id: 'nap',
    revision: 'preview-v1',
    kind: 'nap',
    startedAt: at(start),
    endedAt: at(end),
    measuredAt: at(end),
    status: 'completed',
    pauseSeconds,
  });
  return date === '2026-10-19'
    ? [
        point('prior-bed', 'bedtime', '2026-10-18T18:45:00.000Z', '2026-10-18T18:55:00.000Z'),
        point('wake', 'wake-up', at('04:50:00')),
        { ...point('early-diaper', 'diaper', at('06:15:00')), diaperType: 'wet' },
        { ...point('later-diaper', 'diaper', at('07:49:00')), diaperType: 'mixed' },
        feed('feed', '08:16:00', '08:51:37', 2137, 'RIGHT'),
        nap('08:26:00', '08:51:00'),
      ]
    : [
        point('prior-bed', 'bedtime', '2026-10-17T18:50:00.000Z', '2026-10-17T19:00:00.000Z'),
        { ...nap('01:40:00', '02:00:00'), id: 'night-waking', kind: 'night-waking' },
        point('wake', 'wake-up', at('05:57:00')),
        feed('morning-feed', '05:57:00', '06:10:14', 794, 'RIGHT'),
        nap('09:20:00', '10:52:51', 102),
        { ...point('diaper', 'diaper', at('13:46:00')), diaperType: 'wet' },
        feed('afternoon-feed', '13:52:00', '13:59:07', 427, 'LEFT'),
        feed('evening-feed', '18:00:00', '18:09:49', 589, 'RIGHT'),
        point('bed', 'bedtime', at('18:45:00'), at('18:55:00')),
      ];
}
