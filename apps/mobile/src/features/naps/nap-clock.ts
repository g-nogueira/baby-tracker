import { zonedDateTimeParts } from './calendar-day';

export interface ClockPoint {
  x: number;
  y: number;
}

export function pointOn24HourClock(instant: Date, timezone: string, radius: number): ClockPoint {
  const { hour, minute, second } = zonedDateTimeParts(instant, timezone);
  const fractionOfDay = (hour * 3_600 + minute * 60 + second) / 86_400;
  const angle = fractionOfDay * Math.PI * 2 - Math.PI / 2;

  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
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
