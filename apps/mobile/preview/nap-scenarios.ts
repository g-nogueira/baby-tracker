import type { SleepActivity } from '../src/features/care-service/contracts';
/** Shared scenario: 41:13 asleep, a 14:36 pause, just resumed. No family records. */
export function resumedNap(now: number): SleepActivity {
  const at = (offset: number) => new Date(now + offset).toISOString();
  return {
    id: 'preview-resumed-nap',
    revision: 'v1',
    kind: 'nap',
    status: 'active',
    startedAt: at(-3349000),
    endedAt: null,
    measuredAt: at(0),
    pauseSeconds: 876,
    pauses: [{ id: 'pause:0', startedAt: at(-899000), endedAt: at(-23000) }],
  };
}
