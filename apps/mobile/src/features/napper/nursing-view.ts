import { projectCycle, resolveCanonicalCycles } from '@baby-tracker/domain';
import { calendarDayForInstant } from '@/features/naps/calendar-day';
import {
  buildRadialCycleViews,
  type RadialCycleView,
} from '@/features/timeline/radial-cycle-state';
import type { WireLog } from './contracts';
import { type NursingLog, nursingReadReason, nursingTotals, readNursing } from './nursing';

/** A malformed historical feed stays read-only without disabling an unrelated valid feed. */
export function inspectNursingLogs(logs: WireLog[], now: Date) {
  const valid: NursingLog[] = [];
  const unsupportedIds: string[] = [];
  const issues: { id: string; reason: string }[] = [];
  for (const log of logs) {
    if (log.category !== 'NURSING') continue;
    try {
      const feed = readNursing(log);
      nursingTotals(feed, now);
      valid.push(feed);
    } catch (error) {
      unsupportedIds.push(String(log.id));
      issues.push({ id: String(log.id), reason: nursingReadReason(error) });
    }
  }
  return { valid, unsupportedIds, issues };
}

/** Read projection only; Napper records never become local SQLite aggregates. */
export function nursingCycle(
  logs: WireLog[],
  babyId: string,
  date: string,
  timezone: string,
  now: Date,
): RadialCycleView {
  const cycle = resolveCanonicalCycles([], { childId: babyId, localDate: date, timezone }).day;
  // The domain projection requires canonical UTC. Napper uses offset-bearing wire
  // timestamps; normalize only this read model and retain original wire values for saves.
  const feeds = logs
    .filter((log) => log.category === 'NURSING')
    .map((wire) => {
      const feed = readNursing(wire);
      return {
        ...feed,
        start: new Date(feed.start).toISOString(),
        end: new Date(feed.end).toISOString(),
      };
    });
  const projection = projectCycle(
    cycle,
    feeds.map((feed) =>
      feed.open || feed.start !== feed.end
        ? {
            type: 'interval' as const,
            id: feed.id,
            lane: 'inner',
            startedAt: feed.start,
            endedAt: feed.open ? null : feed.end,
          }
        : { type: 'point' as const, id: feed.id, lane: 'inner', occurredAt: feed.start },
    ),
    { now },
  );
  const base = buildRadialCycleViews({
    childId: babyId,
    localDate: date,
    timezone,
    now,
    careEvents: [],
    nursingSessions: [],
    sleepSessions: [],
  }).day;
  return {
    ...base,
    projection,
    records: projection.records.map((projected) => {
      const feed = feeds.find((feed) => feed.id === projected.id);
      if (!feed) throw new Error('Missing Nursing record.');
      return {
        id: feed.id,
        editorRecordId: feed.id,
        kind: 'nursing' as const,
        occurredAt: feed.start,
        endedAt: feed.open ? null : feed.end,
        status: feed.open
          ? feed.pauses.some((p) => p.end === null)
            ? ('paused' as const)
            : ('active' as const)
          : ('completed' as const),
        diaperType: null,
        projection: projected,
      };
    }),
  };
}
export function dateFeeds(logs: WireLog[], date: string, timezone: string) {
  return logs
    .filter(
      (log) =>
        log.category === 'NURSING' &&
        calendarDayForInstant(new Date(String(log.start)), timezone) === date,
    )
    .sort((a, b) => Date.parse(String(b.start)) - Date.parse(String(a.start)));
}
