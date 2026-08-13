import { describe, expect, it } from 'vitest';

import { formatLiveDuration, pointOn24HourClock } from './nap-clock';

describe('nap clock', () => {
  it('places local midnight, morning, noon, and evening around a 24-hour dial', () => {
    expect(pointOn24HourClock(new Date('2026-08-13T23:00:00.000Z'), 'Europe/Lisbon', 100)).toEqual(
      expect.objectContaining({ x: expect.closeTo(0), y: expect.closeTo(-100) }),
    );
    expect(pointOn24HourClock(new Date('2026-08-13T05:00:00.000Z'), 'Europe/Lisbon', 100)).toEqual(
      expect.objectContaining({ x: expect.closeTo(100), y: expect.closeTo(0) }),
    );
    expect(pointOn24HourClock(new Date('2026-08-13T11:00:00.000Z'), 'Europe/Lisbon', 100)).toEqual(
      expect.objectContaining({ x: expect.closeTo(0), y: expect.closeTo(100) }),
    );
    expect(pointOn24HourClock(new Date('2026-08-13T17:00:00.000Z'), 'Europe/Lisbon', 100)).toEqual(
      expect.objectContaining({ x: expect.closeTo(-100), y: expect.closeTo(0) }),
    );
  });

  it('formats a running timer with live seconds', () => {
    expect(formatLiveDuration(4_999)).toBe('00:04');
    expect(formatLiveDuration(62_000)).toBe('01:02');
    expect(formatLiveDuration(3_723_000)).toBe('1:02:03');
  });
});
