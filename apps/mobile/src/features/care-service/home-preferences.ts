export const homeActionIds = ['night', 'sleep', 'nursing', 'diaper', 'medicine'] as const;
export type HomeActionId = (typeof homeActionIds)[number];
export interface HomePreferences {
  actions: HomeActionId[];
  bedtimeFromHour: number;
}
export const defaultHomePreferences: HomePreferences = {
  actions: ['night', 'sleep', 'nursing', 'diaper'],
  bedtimeFromHour: 17,
};
export function parseHomePreferences(value: unknown): HomePreferences {
  if (!value || typeof value !== 'object')
    return { ...defaultHomePreferences, actions: [...defaultHomePreferences.actions] };
  const p = value as Partial<HomePreferences>;
  return {
    actions: Array.isArray(p.actions)
      ? [...new Set(p.actions.filter((a) => homeActionIds.includes(a)))]
      : [...defaultHomePreferences.actions],
    bedtimeFromHour:
      typeof p.bedtimeFromHour === 'number' &&
      Number.isInteger(p.bedtimeFromHour) &&
      p.bedtimeFromHour >= 0 &&
      p.bedtimeFromHour <= 23
        ? p.bedtimeFromHour
        : 17,
  };
}
export function visibleHomeActions(
  preferences: HomePreferences,
  now: Date,
  timezone: string,
  nightActive: boolean,
  napActive: boolean,
): HomeActionId[] {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      hourCycle: 'h23',
      timeZone: timezone,
    }).format(now),
  );
  return homeActionIds.filter(
    (id) =>
      (id === 'night' && nightActive) ||
      (id === 'sleep' && napActive) ||
      (preferences.actions.includes(id) && (id !== 'night' || hour >= preferences.bedtimeFromHour)),
  );
}
