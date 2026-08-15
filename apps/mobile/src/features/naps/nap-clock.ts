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

export function pointOn24HourClock(instant: Date, timezone: string, radius: number): ClockPoint {
  return pointAtClockFraction(fractionOfLocalDay(instant, timezone), radius);
}

export function pointAtClockFraction(fraction: number, radius: number): ClockPoint {
  const angle = fraction * Math.PI * 2 - Math.PI / 2;

  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

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

function fractionOfLocalDay(instant: Date, timezone: string): number {
  const { hour, minute, second } = zonedDateTimeParts(instant, timezone);
  return (hour * 3_600 + minute * 60 + second) / 86_400;
}

function instantMilliseconds(instant: string): number {
  const milliseconds = new Date(instant).getTime();
  if (!Number.isFinite(milliseconds)) throw new Error('Valid nap and day instants are required.');
  return milliseconds;
}

export function formatLiveDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    : `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
