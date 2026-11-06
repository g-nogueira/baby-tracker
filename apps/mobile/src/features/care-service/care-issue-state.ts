import type { CareActivity, CareIssue } from './contracts';
import { byStart } from './sleep-state';

export interface CareIssueGroup {
  id: string;
  message: string;
  count: number;
  activities: CareActivity[];
}

/** Group review messages without dropping their source records or optimistic revisions. */
export function groupReviewIssues(
  issues: readonly CareIssue[],
  activities: readonly CareActivity[],
  cycleIds?: ReadonlySet<string>,
): CareIssueGroup[] {
  const records = new Map(activities.map((activity) => [activity.id, activity]));
  const groups = new Map<string, { message: string; ids: Set<string>; issues: Set<string> }>();
  for (const issue of issues) {
    if (issue.blocksWrites) continue;
    const ids = issue.activityIds ?? [];
    // Unknown/unreadable source records stay visible; absence is not proof of another cycle.
    if (
      cycleIds &&
      ids.length > 0 &&
      ids.every((id) => records.has(id)) &&
      !ids.some((id) => cycleIds.has(id))
    )
      continue;
    const key = JSON.stringify([issue.rule ?? null, issue.message]);
    const group = groups.get(key) ?? {
      message: issue.message,
      ids: new Set<string>(),
      issues: new Set<string>(),
    };
    group.issues.add(issue.id);
    for (const id of ids) group.ids.add(id);
    groups.set(key, group);
  }
  return [...groups].map(([id, group]) => ({
    id,
    message: group.message,
    count: group.issues.size,
    activities: [...group.ids].flatMap((id) => records.get(id) ?? []).sort(byStart),
  }));
}
