export function calendarDayForInstant(instant: Date, timezone: string): string {
  const parts = calendarFormatter(timezone).formatToParts(instant);
  const year = partNumber(parts, 'year');
  const month = partNumber(parts, 'month');
  const day = partNumber(parts, 'day');
  return formatCalendarDay(year, month, day);
}

export function shiftCalendarDay(calendarDay: string, days: number): string {
  const { year, month, day } = parseCalendarDay(calendarDay);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatCalendarDay(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

export function zonedDayBounds(calendarDay: string, timezone: string): [string, string] {
  return [
    zonedMidnight(calendarDay, timezone).toISOString(),
    zonedMidnight(shiftCalendarDay(calendarDay, 1), timezone).toISOString(),
  ];
}

function zonedMidnight(calendarDay: string, timezone: string): Date {
  const target = parseCalendarDay(calendarDay);
  return instantForZonedDateTime({ ...target, hour: 0, minute: 0, second: 0 }, timezone);
}

export interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function instantForZonedDateTime(target: ZonedDateTimeParts, timezone: string): Date {
  const targetAsUtc = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
  );
  let candidate = targetAsUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedDateTimeParts(new Date(candidate), timezone);
    const observedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    candidate -= observedAsUtc - targetAsUtc;
  }

  const resolved = new Date(candidate);
  const resolvedParts = zonedDateTimeParts(resolved, timezone);
  if (!sameDateTimeParts(resolvedParts, target)) {
    throw new Error('This local time does not exist because the clocks change on this date.');
  }
  return resolved;
}

export function zonedDateTimeParts(instant: Date, timezone: string): ZonedDateTimeParts {
  const parts = dateTimeFormatter(timezone).formatToParts(instant);
  return {
    year: partNumber(parts, 'year'),
    month: partNumber(parts, 'month'),
    day: partNumber(parts, 'day'),
    hour: partNumber(parts, 'hour'),
    minute: partNumber(parts, 'minute'),
    second: partNumber(parts, 'second'),
  };
}

function sameDateTimeParts(left: ZonedDateTimeParts, right: ZonedDateTimeParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function parseCalendarDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    throw new Error('A calendar day in YYYY-MM-DD format is required.');
  }

  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function formatCalendarDay(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

function partNumber(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const value = parts.find((part) => part.type === type)?.value;
  if (value === undefined) throw new Error(`Missing ${type} from formatted date.`);
  return Number(value);
}

function calendarFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function dateTimeFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}
