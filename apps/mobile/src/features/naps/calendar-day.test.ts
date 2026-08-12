import { describe, expect, it } from 'vitest';

import {
  calendarDayForInstant,
  instantForZonedDateTime,
  shiftCalendarDay,
  zonedDayBounds,
} from './calendar-day';

describe('calendar day boundaries', () => {
  it('groups instants using the selected IANA timezone', () => {
    expect(calendarDayForInstant(new Date('2026-08-12T00:15:00.000Z'), 'Europe/Lisbon')).toBe(
      '2026-08-12',
    );
    expect(calendarDayForInstant(new Date('2026-08-11T23:15:00.000Z'), 'Europe/Lisbon')).toBe(
      '2026-08-12',
    );
  });

  it('creates DST-aware Europe/Lisbon day bounds', () => {
    expect(zonedDayBounds('2026-03-29', 'Europe/Lisbon')).toEqual([
      '2026-03-29T00:00:00.000Z',
      '2026-03-29T23:00:00.000Z',
    ]);
    expect(zonedDayBounds('2026-10-25', 'Europe/Lisbon')).toEqual([
      '2026-10-24T23:00:00.000Z',
      '2026-10-26T00:00:00.000Z',
    ]);
  });

  it('rejects a nonexistent wall time during the spring DST jump', () => {
    expect(() =>
      instantForZonedDateTime(
        { year: 2026, month: 3, day: 29, hour: 1, minute: 30, second: 0 },
        'Europe/Lisbon',
      ),
    ).toThrow('This local time does not exist because the clocks change on this date.');
  });

  it('shifts calendar dates without inheriting the runtime timezone', () => {
    expect(shiftCalendarDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftCalendarDay('2026-03-01', -1)).toBe('2026-02-28');
  });
});
