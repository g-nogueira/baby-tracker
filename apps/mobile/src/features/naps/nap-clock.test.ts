import { describe, expect, it } from 'vitest';

import { formatLiveDuration, pointOn24HourClock, projectNapOnCalendarDay } from './nap-clock';

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

  it('projects a completed nap clockwise from its exact start in proportion to duration', () => {
    const projection = projectNapOnCalendarDay(
      {
        id: 'nap-1',
        startedAt: '2026-08-13T05:00:00.000Z',
        endedAt: '2026-08-13T07:00:00.000Z',
      },
      '2026-08-12T23:00:00.000Z',
      '2026-08-13T23:00:00.000Z',
      new Date('2026-08-13T12:00:00.000Z'),
      'Europe/Lisbon',
    );

    expect(projection).toEqual(
      expect.objectContaining({
        napId: 'nap-1',
        startFraction: 0.25,
        sweepFraction: 2 / 24,
        showsStartIcon: true,
        isContinuation: false,
      }),
    );
  });

  it('uses now for an active nap without mutating the persisted start', () => {
    const projection = projectNapOnCalendarDay(
      { id: 'active-nap', startedAt: '2026-08-13T09:00:00.000Z', endedAt: null },
      '2026-08-12T23:00:00.000Z',
      '2026-08-13T23:00:00.000Z',
      new Date('2026-08-13T10:30:00.000Z'),
      'Europe/Lisbon',
    );

    expect(projection).toEqual(
      expect.objectContaining({
        napId: 'active-nap',
        segmentStartedAt: '2026-08-13T09:00:00.000Z',
        segmentEndedAt: '2026-08-13T10:30:00.000Z',
        sweepFraction: 1.5 / 24,
        showsStartIcon: true,
      }),
    );
  });

  it('renders cross-midnight time on both days without inventing another start icon', () => {
    const nap = {
      id: 'cross-midnight',
      startedAt: '2026-08-13T22:50:00.000Z',
      endedAt: '2026-08-13T23:20:00.000Z',
    };
    const firstDay = projectNapOnCalendarDay(
      nap,
      '2026-08-12T23:00:00.000Z',
      '2026-08-13T23:00:00.000Z',
      new Date('2026-08-14T00:00:00.000Z'),
      'Europe/Lisbon',
    );
    const secondDay = projectNapOnCalendarDay(
      nap,
      '2026-08-13T23:00:00.000Z',
      '2026-08-14T23:00:00.000Z',
      new Date('2026-08-14T00:00:00.000Z'),
      'Europe/Lisbon',
    );

    expect(firstDay).toEqual(
      expect.objectContaining({
        showsStartIcon: true,
        isContinuation: false,
      }),
    );
    expect(firstDay?.startFraction).toBeCloseTo((23 + 50 / 60) / 24);
    expect(firstDay?.sweepFraction).toBeCloseTo(10 / (24 * 60));
    expect(secondDay).toEqual(
      expect.objectContaining({
        startFraction: 0,
        showsStartIcon: false,
        isContinuation: true,
      }),
    );
    expect(secondDay?.sweepFraction).toBeCloseTo(20 / (24 * 60));
  });

  it('immediately projects a longer segment when the saved end moves later', () => {
    const base = {
      id: 'edited-nap',
      startedAt: '2026-08-13T09:00:00.000Z',
    };
    const shorter = projectNapOnCalendarDay(
      { ...base, endedAt: '2026-08-13T09:30:00.000Z' },
      '2026-08-12T23:00:00.000Z',
      '2026-08-13T23:00:00.000Z',
      new Date('2026-08-13T12:00:00.000Z'),
      'Europe/Lisbon',
    );
    const longer = projectNapOnCalendarDay(
      { ...base, endedAt: '2026-08-13T10:00:00.000Z' },
      '2026-08-12T23:00:00.000Z',
      '2026-08-13T23:00:00.000Z',
      new Date('2026-08-13T12:00:00.000Z'),
      'Europe/Lisbon',
    );

    expect(longer?.sweepFraction).toBe((shorter?.sweepFraction ?? 0) * 2);
  });
});
