import type { UtcInstant } from './types';

export function toUtcInstant(value: Date): UtcInstant {
  if (Number.isNaN(value.getTime())) {
    throw new Error('A valid occurrence time is required.');
  }

  return value.toISOString();
}

export function elapsedMilliseconds(startedAt: UtcInstant, now: Date): number {
  const startTime = new Date(startedAt).getTime();
  const endTime = now.getTime();

  if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
    throw new Error('Valid elapsed-time boundaries are required.');
  }

  return Math.max(0, endTime - startTime);
}

export function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return hours > 0 ? `${hours} h ${minutes.toString().padStart(2, '0')} min` : `${minutes} min`;
}
