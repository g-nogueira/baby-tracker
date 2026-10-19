import type { CareActivity } from './contracts';
import { nursingTimes } from './nursing';
import { activityDuration, byStart, sleepBoundaryAt } from './sleep-state';
import { sleepConflicts } from './sleep-conflicts';
import { formatLiveDuration } from '@/features/naps/nap-clock';

export interface CareLogSummary {
  kind: 'wake-window' | 'sleep-session';
  durationMs: number;
}
export interface CareLogEntry {
  activity: CareActivity;
  title: string;
  details: string[];
  summary: CareLogSummary | null;
}

/** Durations describe active time, whereas the card's range retains both recorded instants. */
export function careLogDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return minutes >= 60
    ? `${pad(Math.floor(minutes / 60))}h ${pad(minutes % 60)}m`
    : `${pad(minutes)}m ${pad(seconds % 60)}s`;
}
export function careLogWindow(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** Display-only rows: the preceding Night supplies context, never extra editable Day records. */
export function careLogEntries(
  visible: readonly CareActivity[],
  context: readonly CareActivity[],
  now: Date,
): CareLogEntry[] {
  const summaries = phaseSummaries(context, now);
  const firstBoundary = [...visible]
    .filter((a) => a.kind === 'wake-up' || a.kind === 'bedtime')
    .sort(byStart)[0];
  const wakeFirst = firstBoundary?.kind === 'wake-up';
  let nap = 0;
  return [...visible]
    .sort(
      (a, b) =>
        (wakeFirst ? Number(b.kind === 'wake-up') - Number(a.kind === 'wake-up') : 0) ||
        a.startedAt.localeCompare(b.startedAt) ||
        Number(b.kind === 'wake-up') - Number(a.kind === 'wake-up') ||
        byStart(a, b),
    )
    .map((activity) => {
      let title: string;
      const details: string[] = [];
      switch (activity.kind) {
        case 'nap':
          title = ['First nap', 'Second nap', 'Third nap', 'Fourth nap'][nap++] ?? `Nap ${nap}`;
          details.push(careLogDuration(activityDuration(activity, now)));
          break;
        case 'night-waking':
          title = 'Night waking';
          details.push(careLogDuration(activityDuration(activity, now)));
          break;
        case 'nursing': {
          title = 'Nursing';
          const t = nursingTimes(activity, now);
          details.push(careLogDuration(t.total * 1000));
          const sides = [
            t.left > 0 ? `${formatLiveDuration(t.left * 1000)} Left` : null,
            t.right > 0 ? `${formatLiveDuration(t.right * 1000)} Right` : null,
          ].filter(Boolean);
          if (sides.length) details.push(sides.join(' · '));
          break;
        }
        case 'bedtime':
          title = 'Fell asleep';
          if (activity.endedAt && activity.endedAt !== activity.startedAt)
            details.push(
              careLogDuration(Date.parse(activity.endedAt) - Date.parse(activity.startedAt)),
            );
          break;
        case 'wake-up':
          title = 'Wake up';
          break;
        case 'diaper':
          title = 'Diaper change';
          if (activity.diaperType)
            details.push(activity.diaperType[0].toUpperCase() + activity.diaperType.slice(1));
          break;
        case 'medicine':
          title = 'Medicine';
          details.push(activity.note || 'No note');
          break;
      }
      if (activity.status !== 'completed')
        details.push(activity.status === 'paused' ? 'Paused' : 'Running');
      return { activity, title, details, summary: summaries.get(activity.id) ?? null };
    });
}

type Phase = 'awake' | 'asleep';
interface PhaseEvent {
  at: number;
  phase: Phase;
  activityId: string;
  summarizes: boolean;
}
function phaseSummaries(context: readonly CareActivity[], now: Date) {
  const invalid = new Set(sleepConflicts(context).flatMap((conflict) => conflict.ids));
  const events: PhaseEvent[] = [];
  for (const activity of context) {
    if (activity.kind === 'nursing' || activity.kind === 'diaper' || activity.kind === 'medicine')
      continue;
    const asleep = activity.kind === 'bedtime' || activity.kind === 'nap';
    events.push({
      at: Date.parse(activity.kind === 'bedtime' ? sleepBoundaryAt(activity) : activity.startedAt),
      phase: asleep ? 'asleep' : 'awake',
      activityId: activity.id,
      summarizes: true,
    });
    // Nap duration is already on its card. Its end starts the next wake window.
    if (
      (activity.kind === 'nap' || activity.kind === 'night-waking') &&
      activity.status === 'completed' &&
      activity.endedAt
    )
      events.push({
        at: Date.parse(activity.endedAt),
        phase: asleep ? 'awake' : 'asleep',
        activityId: activity.id,
        summarizes: false,
      });
  }
  events.sort(
    (a, b) =>
      a.at - b.at ||
      Number(a.summarizes) - Number(b.summarizes) ||
      a.activityId.localeCompare(b.activityId),
  );
  const summaries = new Map<string, CareLogSummary>();
  events.reduce<PhaseEvent | null>((previous, event) => {
    if (event.at > now.getTime()) return previous;
    if (!Number.isFinite(event.at) || invalid.has(event.activityId)) return null;
    if (previous?.phase === event.phase) return null;
    if (previous && event.summarizes && event.at > previous.at)
      summaries.set(event.activityId, {
        kind: previous.phase === 'awake' ? 'wake-window' : 'sleep-session',
        durationMs: event.at - previous.at,
      });
    return event;
  }, null);
  return summaries;
}
