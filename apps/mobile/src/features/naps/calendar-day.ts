/**
 * Converts an instant to its calendar date in the specified timezone.
 *
 * @param instant - The instant to convert
 * @param timezone - The IANA timezone used to determine the calendar date
 * @returns The calendar date formatted as `YYYY-MM-DD`
 */
export function calendarDayForInstant(instant: Date, timezone: string): string {
  const parts = calendarFormatter(timezone).formatToParts(instant);
  const year = partNumber(parts, 'year');
  const month = partNumber(parts, 'month');
  const day = partNumber(parts, 'day');
  return formatCalendarDay(year, month, day);
}

/**
 * Shifts a calendar date by a specified number of days.
 *
 * @param calendarDay - The date to shift in `YYYY-MM-DD` format
 * @param days - The number of days to add; negative values move the date earlier
 * @returns The shifted date in `YYYY-MM-DD` format
 */
export function shiftCalendarDay(calendarDay: string, days: number): string {
  const { year, month, day } = parseCalendarDay(calendarDay);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatCalendarDay(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/**
 * Determines the UTC bounds of a calendar day in a timezone.
 *
 * @param calendarDay - The calendar day in `YYYY-MM-DD` format
 * @param timezone - The IANA timezone identifier
 * @returns A tuple containing ISO timestamps for the start of the calendar day and the start of the following day
 */
export function zonedDayBounds(calendarDay: string, timezone: string): [string, string] {
  return [
    zonedMidnight(calendarDay, timezone).toISOString(),
    zonedMidnight(shiftCalendarDay(calendarDay, 1), timezone).toISOString(),
  ];
}

/**
 * Resolves the start of a calendar day in a timezone to an instant.
 *
 * @param calendarDay - The calendar day in `YYYY-MM-DD` format
 * @param timezone - The IANA timezone identifier
 * @returns The instant corresponding to local midnight on the calendar day
 */
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

/**
 * Converts local date-time components in a timezone into an instant.
 *
 * @param target - The local date-time components to resolve
 * @param timezone - The IANA timezone identifier
 * @returns The instant corresponding to the local date-time
 * @throws If the local date-time does not exist because of a clock change
 */
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

/**
 * Extracts the date and time components of an instant in a specified timezone.
 *
 * @param timezone - The IANA timezone used to interpret the instant
 * @returns The instant's year, month, day, hour, minute, and second in the specified timezone
 */
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

/**
 * Determines whether two date-time parts represent the same local date and time.
 *
 * @param left - The first date-time parts to compare
 * @param right - The second date-time parts to compare
 * @returns `true` if all date and time components match, `false` otherwise
 */
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

/**
 * Parses a calendar day in `YYYY-MM-DD` format.
 *
 * @param value - The calendar day string to parse
 * @returns The numeric year, month, and day components
 */
function parseCalendarDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    throw new Error('A calendar day in YYYY-MM-DD format is required.');
  }

  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/**
 * Formats numeric calendar date components as a zero-padded `YYYY-MM-DD` string.
 *
 * @param year - The calendar year
 * @param month - The calendar month
 * @param day - The calendar day
 * @returns The formatted calendar date
 */
function formatCalendarDay(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

/**
 * Extracts a numeric component from formatted date parts.
 *
 * @param parts - The formatted date components to search
 * @param type - The component type to extract
 * @returns The numeric value of the requested component
 * @throws Error if the requested component is missing
 */
function partNumber(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const value = parts.find((part) => part.type === type)?.value;
  if (value === undefined) throw new Error(`Missing ${type} from formatted date.`);
  return Number(value);
}

/**
 * Creates a formatter for calendar dates in the specified timezone.
 *
 * @param timezone - The timezone used to interpret and format dates
 * @returns A date-time formatter configured for numeric year, month, and day output
 */
function calendarFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * Creates a formatter for date and time components in a specified timezone.
 *
 * @param timezone - The IANA timezone identifier used for formatting
 * @returns A formatter configured with two-digit month, day, hour, minute, and second values
 */
function dateTimeFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
