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

  const [date, setDate] = useState(at(0).slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<CareActivity[]>(
    scenario === 'first-nursing'
      ? [wake]
      : scenario === 'day' || scenario === 'history'
        ? [wake, nap, nursing]
        : [bed, waking, nursing],
  );
  const snapshot: CareSnapshot = { activities: rows, issues: [] };
  const model = {
    stage: 'ready',
    baby: { id: 'preview', name: 'Arthur' },
    babies: [{ id: 'preview', name: 'Arthur' }],
    current: snapshot,
    history: snapshot,
    date,
    today: at(0).slice(0, 10),
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
        <CareHome model={model} initialHistoryView={scenario === 'history' ? 'dial' : undefined} />
      </SafeAreaProvider>
    </TrackingFontsContext.Provider>
  );
}
