import { logActivities } from './log-scenarios';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CareHome } from '../src/features/care-service/care-screen';
import { TrackingFontsContext } from '../src/features/shared/tracking-text';
import type {
  CareActivity,
  CareSnapshot,
  CareCommand,
} from '../src/features/care-service/contracts';
import type { useCareTracker } from '../src/features/care-service/use-care-tracker';
// Synthetic, browser-only scenarios. This file is outside the Expo app/router and never calls HTTP.

export function overlapActivities(now: number): CareActivity[] {
  const at = (minutes: number) => new Date(now + minutes * 60000).toISOString();
  return [
    {
      id: 'wake',
      revision: 'v1',
      kind: 'wake-up',
      startedAt: at(-307),
      endedAt: at(-307),
      status: 'completed',
    },
    ...[-222, -127].map(
      (minutes, index): CareActivity => ({
        id: `diaper-${index}`,
        revision: 'v1',
        kind: 'diaper',
        diaperType: 'wet',
        startedAt: at(minutes),
        endedAt: at(minutes),
        status: 'completed',
      }),
    ),
    {
      id: 'feed',
      revision: 'v1',
      kind: 'nursing',
      startedAt: at(-101),
      endedAt: at(-65 - 23 / 60),
      status: 'completed',
      leftSeconds: 0,
      rightSeconds: 2137,
      pauseSeconds: 0,
      measuredAt: at(0),
      lastBreast: 'RIGHT',
    },
    {
      id: 'nap',
      revision: 'v1',
      kind: 'nap',
      startedAt: at(-91),
      endedAt: at(-66),
      status: 'completed',
      pauseSeconds: 0,
      measuredAt: at(0),
    },
  ];
}

export function Preview({
  scenario = 'night',
  now = Date.now(),
}: {
  scenario?: string;
  now?: number;
}) {
  const at = (minutes: number) => new Date(now + minutes * 60000).toISOString();
  const base = (id: string) => ({ id, revision: `${id}-v1` });
  const bed: CareActivity = {
    ...base('bed'),
    kind: 'bedtime',
    startedAt: at(-420),
    endedAt: at(-420),
    status: 'completed',
  };
  const wake: CareActivity = {
    ...base('wake'),
    kind: 'wake-up',
    startedAt: at(-400),
    endedAt: at(-400),
    status: 'completed',
  };
  const nursing: CareActivity = {
    ...base('feed'),
    kind: 'nursing',
    startedAt: at(-12),
    endedAt: null,
    status: 'active',
    leftSeconds: 300,
    rightSeconds: 420,
    pauseSeconds: 0,
    measuredAt: at(0),
    lastBreast: 'RIGHT',
  };
  const waking: CareActivity = {
    ...base('waking'),
    kind: 'night-waking',
    startedAt: at(-79),
    endedAt: null,
    status: 'active',
    pauseSeconds: 0,
    measuredAt: at(0),
  };
  const nap: CareActivity = {
    ...base('nap'),
    kind: 'nap',
    startedAt: at(-80),
    endedAt: at(-30),
    status: 'completed',
    pauseSeconds: 0,
    measuredAt: at(0),
  };

  const routine: CareActivity = {
    ...bed,
    startedAt: at(-119),
    endedAt: at(-109),
  };
  const historyAt = (time: string) => `2026-10-18T${time}:00.000Z`;
  const historyRows: CareActivity[] = [
    { ...wake, startedAt: historyAt('05:57'), endedAt: historyAt('05:57') },
    {
      ...nursing,
      id: 'morning-feed',
      startedAt: historyAt('05:57'),
      endedAt: historyAt('06:05'),
      status: 'completed',
    },
    { ...nap, startedAt: historyAt('09:40'), endedAt: historyAt('10:45') },
    { ...nursing, startedAt: historyAt('14:05'), endedAt: historyAt('14:17'), status: 'completed' },
    {
      id: 'diaper',
      revision: 'v1',
      kind: 'diaper',
      startedAt: historyAt('14:00'),
      endedAt: historyAt('14:00'),
      status: 'completed',
      diaperType: 'wet',
    },
    {
      ...nursing,
      id: 'evening-feed',
      startedAt: historyAt('18:15'),
      endedAt: historyAt('18:25'),
      status: 'completed',
    },
    { ...routine, startedAt: historyAt('18:45'), endedAt: historyAt('18:55') },
  ];
  const [date, setDate] = useState(
    scenario === 'history' || scenario === 'log-bedtime' ? '2026-10-18' : at(0).slice(0, 10),
  );
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<CareActivity[]>(
    scenario === 'nap-progress' || scenario === 'nap-paused'
      ? [
          wake,
          { ...nap, id: 'previous-nap', startedAt: at(-300), endedAt: at(-235) },
          {
            ...nap,
            id: 'running-nap',
            startedAt: at(-26),
            endedAt: null,
            status: scenario === 'nap-paused' ? 'paused' : 'active',
            measuredAt: at(0),
          },
        ]
      : scenario === 'log-today' || scenario === 'log-bedtime'
        ? logActivities(scenario === 'log-today' ? '2026-10-19' : '2026-10-18')
        : ['overlapping-dial', 'nearby-activities', 'diaper'].includes(scenario)
          ? overlapActivities(now)
          : scenario === 'feeding-dial'
            ? [
                { ...wake, startedAt: at(-216), endedAt: at(-216) },
                {
                  id: 'early-diaper',
                  revision: 'v1',
                  kind: 'diaper',
                  diaperType: 'wet',
                  startedAt: at(-90),
                  endedAt: at(-90),
                  status: 'completed',
                },
                {
                  id: 'near-feed-diaper',
                  revision: 'v1',
                  kind: 'diaper',
                  diaperType: 'wet',
                  startedAt: at(-33),
                  endedAt: at(-33),
                  status: 'completed',
                },
                { ...nursing, startedAt: at(-10), leftSeconds: 0, rightSeconds: 600 },
              ]
            : scenario === 'night-forecast'
              ? [
                  {
                    ...routine,
                    startedAt: '2026-10-18T18:45:00.000Z',
                    endedAt: '2026-10-18T18:55:00.000Z',
                  },
                ]
              : scenario === 'day-markers' || scenario === 'wake-up'
                ? [
                    {
                      ...wake,
                      startedAt: '2026-10-19T04:30:00.000Z',
                      endedAt: '2026-10-19T04:30:00.000Z',
                    },
                    {
                      id: 'day-diaper',
                      revision: 'v1',
                      kind: 'diaper',
                      diaperType: 'wet',
                      startedAt: '2026-10-19T06:14:00.000Z',
                      endedAt: '2026-10-19T06:14:00.000Z',
                      status: 'completed',
                    },
                  ]
                : scenario === 'night-asleep' || scenario === 'bedtime-range'
                  ? [routine]
                  : scenario === 'first-nursing'
                    ? [wake]
                    : scenario === 'day' || scenario === 'history'
                      ? scenario === 'history'
                        ? [wake, nap]
                        : [wake, nap, nursing]
                      : [bed, waking, nursing],
  );
  const snapshot: CareSnapshot = {
    activities: scenario === 'log-bedtime' ? logActivities('2026-10-19') : rows,
    issues: [],
  };
  const historySnapshot =
    scenario === 'history'
      ? { activities: historyRows, issues: [] }
      : scenario === 'log-bedtime'
        ? { activities: rows, issues: [] }
        : snapshot;
  const model = {
    stage: 'ready',
    baby: { id: 'preview', name: 'Arthur' },
    babies: [{ id: 'preview', name: 'Arthur' }],
    current: snapshot,
    history: historySnapshot,
    date,
    today: scenario === 'history' || scenario === 'log-bedtime' ? '2026-10-18' : at(0).slice(0, 10),
    timezone: 'Europe/Lisbon',
    providerName: 'Component preview',
    busy: false,
    needsRefresh: false,
    updatedAt: new Date(now),
    error,
    refreshing: false,
    clearError: () => setError(null),
    setDate,
    refresh: async () => {},
    showProfiles: () => {},
    signOut: async () => {},
    execute: async (command: CareCommand) => {
      if (command.type === 'remove-activity')
        setRows((r) => r.filter((a) => a.id !== command.expected.id));
      else setError('Preview only: the command was not sent to a service.');
      return command.type === 'remove-activity';
    },
  } as unknown as ReturnType<typeof useCareTracker>;
  return (
    <TrackingFontsContext.Provider value={true}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 16 },
        }}
      >
        <CareHome
          model={model}
          initialHistoryView={
            scenario.startsWith('log-') ? 'log' : scenario === 'history' ? 'dial' : undefined
          }
        />
      </SafeAreaProvider>
    </TrackingFontsContext.Provider>
  );
}
