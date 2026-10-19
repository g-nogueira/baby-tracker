import type { CareActivity, SleepActivity } from './contracts';
import { activityDuration } from './sleep-state';

/** Display-only estimate from up to seven preceding completed naps; never a provider forecast. */
export function napProgress(nap: SleepActivity, activities: readonly CareActivity[], now: Date) {
  const samples = activities
    .filter(
      (a): a is SleepActivity => a.kind === 'nap' && a.status === 'completed' && a.id !== nap.id,
    )
    .filter((a) => {
      const start = Date.parse(a.startedAt);
      const end = Date.parse(a.endedAt ?? '');
      return (
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end <= Date.parse(nap.startedAt) &&
        end > start &&
        Number.isFinite(a.pauseSeconds) &&
        a.pauseSeconds >= 0 &&
        a.pauseSeconds * 1000 < end - start
      );
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 7);
  const targetMs = samples.length
    ? samples.reduce((sum, sample) => sum + activityDuration(sample, now), 0) / samples.length
    : 60 * 60000;
  const elapsedMs = activityDuration(nap, now);
  const remainingMinutes = Math.max(0, Math.ceil((targetMs - elapsedMs) / 60000));
  return {
    fraction: Math.min(1, Math.max(0, elapsedMs / targetMs)),
    remainingLabel: remainingMinutes > 0 ? `~${remainingMinutes}m` : 'Over est.',
    estimateLabel: `${remainingMinutes > 0 ? `Estimated ${remainingMinutes} minutes remaining` : 'Past estimated nap length'}. ${samples.length ? `Based on ${samples.length} recent completed naps` : 'Based on a 60 minute fallback'}.`,
  };
}
