import type { UtcInstant } from './types';

export function toUtcInstant(value: Date): UtcInstant {
  if (Number.isNaN(value.getTime())) {
    throw new Error('A valid occurrence time is required.');
  }

  return value.toISOString();
}

export function elapsedMilliseconds(startedAt: UtcInstant, now: Date): number {
  return Math.max(0, now.getTime() - new Date(startedAt).getTime());
}

export function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return hours > 0 ? `${hours} h ${minutes.toString().padStart(2, '0')} min` : `${minutes} min`;
}
