import { zonedDateTimeParts } from './calendar-day';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

export interface ClockPoint {
  x: number;
  y: number;
}

export interface NapClockRecord {
  id: string;
  startedAt: string;
  endedAt: string | null;
}

export interface NapDayProjection {
  napId: string;
  segmentStartedAt: string;
  segmentEndedAt: string;
  startFraction: number;
  sweepFraction: number;
  showsStartIcon: boolean;
  isContinuation: boolean;
}

/**
 * Converts an instant into its position on a 24-hour clock for a timezone.
 *
 * @param instant - The instant to place on the clock
 * @param timezone - The timezone used to determine the local time
 * @param radius - The clock radius
 * @returns Cartesian coordinates for the instant on the clock
 */
export function pointOn24HourClock(instant: Date, timezone: string, radius: number): ClockPoint {
  return pointAtClockFraction(fractionOfLocalDay(instant, timezone), radius);
}

/**
 * Converts a normalized 24-hour clock fraction into a point on a circle.
 *
 * @param fraction - The clock fraction, where `0` is the top of the circle.
 * @param radius - The circle's radius.
 * @returns The Cartesian coordinates corresponding to the clock fraction.
 */
export function pointAtClockFraction(fraction: number, radius: number): ClockPoint {
  const angle = fraction * Math.PI * 2 - Math.PI / 2;

  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

/**
 * Projects a nap onto a calendar-day interval.
 *
 * @param nap - The nap record to project
 * @param dayStartedAt - The start of the calendar-day interval
 * @param nextDayStartedAt - The end of the calendar-day interval
 * @param now - The instant used as the end time for an ongoing nap
 * @param timezone - The timezone used to calculate the local-day position
 * @returns The clipped nap projection, or `null` when the nap does not overlap the interval
 * @throws Error if the calendar-day interval does not have a positive duration
 */
export function projectNapOnCalendarDay(
  nap: NapClockRecord,
  dayStartedAt: string,
  nextDayStartedAt: string,
  now: Date,
  timezone: string,
): NapDayProjection | null {
  const startedAt = instantMilliseconds(nap.startedAt);
  const endedAt = nap.endedAt === null ? now.getTime() : instantMilliseconds(nap.endedAt);
  const dayStart = instantMilliseconds(dayStartedAt);
  const dayEnd = instantMilliseconds(nextDayStartedAt);

  if (dayEnd <= dayStart) throw new Error('A positive calendar-day interval is required.');

  const clippedStart = Math.max(startedAt, dayStart);
  const clippedEnd = Math.min(endedAt, dayEnd);
  if (clippedEnd <= clippedStart) return null;

  const showsStartIcon = startedAt >= dayStart && startedAt < dayEnd;
  const startFraction = showsStartIcon ? fractionOfLocalDay(new Date(startedAt), timezone) : 0;
  const durationFraction = (clippedEnd - clippedStart) / MILLISECONDS_PER_DAY;
  const sweepFraction =
    clippedEnd === dayEnd ? 1 - startFraction : Math.min(durationFraction, 1 - startFraction);

  return {
    napId: nap.id,
    segmentStartedAt: new Date(clippedStart).toISOString(),
    segmentEndedAt: new Date(clippedEnd).toISOString(),
    startFraction,
    sweepFraction: Math.max(0, sweepFraction),
    showsStartIcon,
    isContinuation: startedAt < dayStart,
  };
}

/**
 * Determines the position of an instant within its local calendar day.
 *
 * @param instant - The instant to evaluate
 * @param timezone - The timezone used to determine the local time
 * @returns The fraction of the local day elapsed, from `0` at midnight to just under `1` before the next midnight
 */
function fractionOfLocalDay(instant: Date, timezone: string): number {
  const { hour, minute, second } = zonedDateTimeParts(instant, timezone);
  return (hour * 3_600 + minute * 60 + second) / 86_400;
}

/**
 * Converts a timestamp string to milliseconds since the Unix epoch.
 *
 * @param instant - The timestamp to parse
 * @returns The timestamp in milliseconds since the Unix epoch
 * @throws If `instant` is not a valid timestamp
 */
function instantMilliseconds(instant: string): number {
  const milliseconds = new Date(instant).getTime();
  if (!Number.isFinite(milliseconds)) throw new Error('Valid nap and day instants are required.');
  return milliseconds;
}

/**
 * Formats a duration for live display.
 *
 * @param milliseconds - The duration in milliseconds
 * @returns The duration formatted as `MM:SS` or `H:MM:SS`
 */
export function formatLiveDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    : `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
