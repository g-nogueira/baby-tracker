/** Napper's compact clock labels; all instants remain in the selected IANA timezone. */
export function clockLabel(date: Date, timezone: string, period = true): string {
  const format = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  });
  return format
    .formatToParts(date)
    .filter((part) => period || part.type !== 'dayPeriod')
    .map((part) => part.value)
    .join('')
    .trim();
}

export function shortDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes === 0) return '<1 min';
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes} min`;
}

/** Calendar labels follow the activity's display zone, including across UTC midnight. */
export function dayLabel(date: Date, now: Date, timezone: string): string {
  const format = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  });
  return format.format(date) === format.format(now)
    ? 'Today'
    : new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: timezone,
      }).format(date);
}
