import {
  CareServiceError,
  type CareActivity,
  type PointActivity,
  type SleepActivity,
} from './contracts';

export const sleepKinds = new Set(['bedtime', 'wake-up', 'nap', 'night-waking']);
export const byStart = (a: CareActivity, b: CareActivity) =>
  a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id);
export function sleepContext(activities: readonly CareActivity[]) {
  const boundaries = activities
    .filter((a): a is PointActivity => a.kind === 'bedtime' || a.kind === 'wake-up')
    .sort(byStart);
  const boundary = boundaries.at(-1) ?? null;
  const night = boundary?.kind === 'bedtime' ? boundary : null;
  const naps = activities.filter(
    (a): a is SleepActivity => a.kind === 'nap' && a.status !== 'completed',
  );
  const wakings = activities.filter(
    (a): a is SleepActivity => a.kind === 'night-waking' && a.status !== 'completed',
  );
  const nap = naps[0] ?? null;
  const waking = wakings[0] ?? null;
  const problem =
    naps.length > 1 || wakings.length > 1 || (nap && (night || waking))
      ? 'More than one sleep activity is running. Review the shared records before changing sleep.'
      : waking && (!night || waking.startedAt <= night.startedAt)
        ? 'A running night waking has no valid bedtime. Review the shared records before changing sleep.'
        : null;
  const latestEnd =
    activities
      .filter((a) => (a.kind === 'nap' || a.kind === 'wake-up') && a.status === 'completed')
      .map((a) => a.endedAt ?? a.startedAt)
      .sort()
      .at(-1) ?? null;
  const lastWaking = night
    ? activities
        .filter((a) => a.kind === 'night-waking' && a.startedAt >= night.startedAt)
        .sort(byStart)
        .at(-1)
    : null;
  return {
    boundary,
    night,
    nap,
    waking,
    problem,
    latestEnd,
    phaseStartedAt:
      waking?.startedAt ??
      (night ? (lastWaking?.endedAt ?? night.startedAt) : (nap?.startedAt ?? latestEnd)),
  };
}
/** Reject ambiguous state at the service boundary as well as disabling unsafe UI actions. */
export function assertSleepContext(activities: readonly CareActivity[]) {
  const state = sleepContext(activities);
  if (state.problem) throw new CareServiceError('conflict', state.problem);
  return state;
}
export function activityDuration(activity: SleepActivity, now: Date): number {
  const through = Date.parse(activity.endedAt ?? now.toISOString());
  return Math.max(0, through - Date.parse(activity.startedAt) - activity.pauseSeconds * 1000);
}
