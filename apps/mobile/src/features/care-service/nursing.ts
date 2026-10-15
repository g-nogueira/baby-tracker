import type { NursingActivity } from './contracts';

/** Live totals are derived from instants; no timer ticks are persisted. */
export function nursingTimes(log: NursingActivity, now: Date) {
  const elapsed = Math.max(0, (now.getTime() - Date.parse(log.measuredAt)) / 1000);
  const pause = Math.round(log.pauseSeconds + (log.status === 'paused' ? elapsed : 0));
  if (log.status === 'completed')
    return {
      left: log.leftSeconds,
      right: log.rightSeconds,
      total: log.leftSeconds + log.rightSeconds,
      pause,
      paused: false,
    };
  const other = log.lastBreast === 'LEFT' ? log.rightSeconds : log.leftSeconds;
  const base = log.lastBreast === 'LEFT' ? log.leftSeconds : log.rightSeconds;
  const current = Math.round(base + (log.status === 'active' ? elapsed : 0));
  return {
    left: log.lastBreast === 'LEFT' ? current : log.leftSeconds,
    right: log.lastBreast === 'RIGHT' ? current : log.rightSeconds,
    total: current + other,
    pause,
    paused: log.status === 'paused',
  };
}
