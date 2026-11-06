import { expect, it } from 'vitest';
import { groupReviewIssues } from './care-issue-state';
import type { CareIssue, PointActivity } from './contracts';

const wake = (id: string, day: string): PointActivity => ({
  id,
  revision: `${id}-reviewed`,
  kind: 'wake-up',
  startedAt: `${day}T07:00:00.000Z`,
  endedAt: `${day}T07:00:00.000Z`,
  status: 'completed',
});
const issue = (id: string, ids: string[]): CareIssue => ({
  id,
  rule: 'boundaries',
  activityIds: ids,
  message: 'Bedtime and Wake up must alternate in time.',
  blocksWrites: false,
});

it('scopes neighboring-window conflicts by cycle record identity, retaining the other endpoint', () => {
  const records = [
    wake('old-1', '2026-11-03'),
    wake('old-2', '2026-11-04'),
    wake('today', '2026-11-06'),
  ];
  const issues = [issue('old-pair', ['old-1', 'old-2']), issue('current-pair', ['old-2', 'today'])];
  const result = groupReviewIssues(issues, records, new Set(['today']));
  expect(result).toEqual([
    expect.objectContaining({ count: 1, activities: [records[1], records[2]] }),
  ]);
  expect(groupReviewIssues([issues[0]], records, new Set(['today']))).toEqual([]);
});

it('groups repeated messages while preserving all distinct conflicts, source IDs and revisions', () => {
  const records = [wake('a', '2026-11-04'), wake('b', '2026-11-05'), wake('c', '2026-11-06')];
  const first = issue('a-b', ['a', 'b']);
  const result = groupReviewIssues([first, first, issue('b-c', ['b', 'c'])], records);
  expect(result).toHaveLength(1);
  expect(result[0].count).toBe(2);
  expect(result[0].activities).toEqual(records);
});

it('keeps unscoped or unreadable-source issues visible and leaves blocking issues to the write guard', () => {
  const records = [wake('today', '2026-11-06')];
  const issues = [
    { id: 'legacy', message: 'Review this activity.', blocksWrites: false },
    issue('missing', ['not-readable']),
    { ...issue('blocking', ['today']), blocksWrites: true },
  ];
  expect(groupReviewIssues(issues, records, new Set(['today']))).toEqual([
    expect.objectContaining({ message: 'Review this activity.', activities: [] }),
    expect.objectContaining({
      message: 'Bedtime and Wake up must alternate in time.',
      activities: [],
    }),
  ]);
});
