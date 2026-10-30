import { expect, it } from 'vitest';
import {
  defaultHomePreferences,
  parseHomePreferences,
  visibleHomeActions,
} from './home-preferences';
it('uses civil time, keeps active sleep controls and respects configured visibility', () => {
  const p = { ...defaultHomePreferences, actions: ['nursing'] as 'nursing'[] };
  expect(
    visibleHomeActions(
      defaultHomePreferences,
      new Date('2026-10-15T15:59:00Z'),
      'Europe/Lisbon',
      false,
      false,
    ),
  ).not.toContain('night');
  expect(
    visibleHomeActions(
      defaultHomePreferences,
      new Date('2026-10-15T16:00:00Z'),
      'Europe/Lisbon',
      false,
      false,
    ),
  ).toContain('night');
  expect(
    visibleHomeActions(p, new Date('2026-10-25T01:30:00Z'), 'Europe/Lisbon', true, true),
  ).toEqual(['night', 'sleep', 'nursing']);
});
it('recovers invalid preference values and preserves deliberate empty/ordered selections', () => {
  expect(
    parseHomePreferences({ actions: ['diaper', 'diaper', 'unknown'], bedtimeFromHour: 99 }),
  ).toEqual({ actions: ['diaper'], bedtimeFromHour: 17 });
  expect(parseHomePreferences({ actions: [], bedtimeFromHour: 0 })).toEqual({
    actions: [],
    bedtimeFromHour: 0,
  });
  expect(parseHomePreferences(null)).toEqual(defaultHomePreferences);
});
