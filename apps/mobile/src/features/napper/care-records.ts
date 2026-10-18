import { readActivityDetails } from './care-details';
import {
  calendarDayForInstant,
  zonedDayBounds,
  zonedDateTimeParts,
} from '@/features/naps/calendar-day';
import type { CareActivity, CareKind, NursingActivity } from '@/features/care-service/contracts';
import { CareServiceError } from '@/features/care-service/contracts';
import { type WireLog, object } from './contracts';
import { nursingReadReason, nursingTotals, readNursing } from './nursing';

export const categories: Record<CareKind, string> = {
  bedtime: 'BED_TIME',
  'wake-up': 'WOKE_UP',
  nap: 'NAP',
  'night-waking': 'NIGHT_WAKING',
  nursing: 'NURSING',
  diaper: 'CHANGED_DIAPER',
  medicine: 'MEDICINE',
};
export const kindForCategory = (category: unknown): CareKind | undefined =>
  (Object.keys(categories) as CareKind[]).find((kind) => categories[kind] === category);
const invalid = (message: string) => new CareServiceError('invalid', message);
export function instant(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw invalid('An activity timestamp is missing or invalid.');
  return new Date(value).toISOString();
}
/** Napper anchors evening bedtimes at the preceding midnight with a minute offset. */
export function bedtimeInstant(log: WireLog): string {
  const start = instant(log.start);
  const minutes = log.startMinutesAfterMidnight;
  if (minutes === undefined || minutes === null || minutes === 0) return start;
  if (
    typeof minutes !== 'number' ||
    !Number.isSafeInteger(minutes) ||
    minutes < 0 ||
    minutes > 1500
  )
    throw invalid('The bedtime offset is unsupported.');
  return new Date(Date.parse(start) + minutes * 60000 + 1).toISOString();
}
/** Serialize the configured IANA zone, including its offset at this instant (DST safe). */
export function zonedTimestamp(at: Date, timezone: string): string {
  if (!Number.isFinite(at.getTime())) throw invalid('Choose a valid time.');
  const p = zonedDateTimeParts(at, timezone);
  const ms = at.getUTCMilliseconds();
  const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, ms);
  const offset = Math.round((local - at.getTime()) / 60000);
  const value = Math.abs(offset);
  return `${new Date(local).toISOString().slice(0, -1)}${offset >= 0 ? '+' : '-'}${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
export function bedtimeFields(at: Date, timezone: string): WireLog {
  const hour = zonedDateTimeParts(at, timezone).hour;
  if (hour < 12)
    return {
      start: zonedTimestamp(at, timezone),
      end: zonedTimestamp(at, timezone),
      startMinutesAfterMidnight: 0,
    };
  const midnight = Date.parse(zonedDayBounds(calendarDayForInstant(at, timezone), timezone)[0]);
  const anchor = midnight - 1;
  return {
    start: zonedTimestamp(new Date(anchor), timezone),
    end: zonedTimestamp(at, timezone),
    startMinutesAfterMidnight: Math.floor((at.getTime() - anchor) / 60000),
  };
}
export function toNursingActivity(
  wire: WireLog,
  revision: string,
  now = new Date(),
): NursingActivity {
  try {
    const log = readNursing(wire);
    const totals = nursingTotals(log, now);
    return {
      id: log.id,
      revision,
      kind: 'nursing',
      startedAt: instant(log.start),
      endedAt: log.open ? null : instant(log.end),
      status: log.open
        ? log.pauses.some((p) => p.end === null)
          ? 'paused'
          : 'active'
        : 'completed',
      leftSeconds: totals.left,
      rightSeconds: totals.right,
      lastBreast: log.last,
      measuredAt: now.toISOString(),
      pauseSeconds:
        log.pauses.reduce(
          (sum, p) =>
            sum +
            Math.max(
              0,
              Math.min(log.open ? now.getTime() : Date.parse(log.end), p.end ?? now.getTime()) -
                p.start,
            ),
          0,
        ) / 1000,
    };
  } catch (error) {
    throw invalid(nursingReadReason(error));
  }
}
/** The final pause may remain open while a Napper timer is paused. */
export function readSleepPauses(wire: WireLog, now: Date) {
  const raw = wire.pauses ?? [];
  if (!Array.isArray(raw)) throw invalid('The sleep pause list is unsupported.');
  let previous = Date.parse(instant(wire.start));
  const through = wire.isOpen ? now.getTime() : Date.parse(instant(wire.end));
  return raw.map((item, index) => {
    const row = object(item);
    const start = typeof row.start === 'number' ? row.start : Date.parse(String(row.start));
    const end =
      row.end == null ? null : typeof row.end === 'number' ? row.end : Date.parse(String(row.end));
    if (
      !Number.isFinite(start) ||
      start < previous ||
      start > through ||
      (end === null
        ? wire.isOpen !== true || index !== raw.length - 1
        : !Number.isFinite(end) || end < start || end > through)
    )
      throw invalid('A sleep pause overlaps another pause or is outside its interval.');
    previous = end ?? through;
    return { start, end };
  });
}
export function readCareRecord(wire: WireLog, revision: string, now: Date): CareActivity | null {
  const kind = kindForCategory(wire.category);
  if (!kind || wire.skipped === true) return null;
  const details = readActivityDetails(wire);
  if (kind === 'nursing')
    return { ...toNursingActivity(wire, revision, now), ...(details ? { details } : {}) };
  if (typeof wire.id !== 'string') throw invalid('An activity ID is missing.');
  const startedAt = kind === 'bedtime' ? bedtimeInstant(wire) : instant(wire.start);
  const end = instant(wire.end);
  if (typeof wire.isOpen !== 'boolean') throw invalid('An activity has an unknown running state.');
  const timed = kind === 'nap' || kind === 'night-waking';
  if (!timed && wire.isOpen)
    throw invalid('An unfinished bedtime routine or point activity must be reviewed in Napper.');
  if (kind === 'bedtime' && Date.parse(end) > now.getTime())
    throw invalid('A bedtime routine ends in the future.');
  if (Date.parse(startedAt) > now.getTime()) throw invalid('An activity starts in the future.');
  if (!wire.isOpen && Date.parse(end) < Date.parse(startedAt))
    throw invalid('An activity ends before it starts.');
  const base = {
    id: wire.id,
    revision,
    ...(details ? { details } : {}),
    startedAt,
    endedAt: wire.isOpen ? null : end,
    status: wire.isOpen ? ('active' as const) : ('completed' as const),
  };
  if (kind === 'nap' || kind === 'night-waking') {
    const pauses = readSleepPauses(wire, now);
    return {
      ...base,
      kind,
      status: wire.isOpen
        ? pauses.some((p) => p.end === null)
          ? 'paused'
          : 'active'
        : 'completed',
      measuredAt: now.toISOString(),
      pauseSeconds: pauses.reduce((sum, p) => sum + ((p.end ?? now.getTime()) - p.start), 0) / 1000,
    };
  }
  if (kind === 'diaper') {
    const diaperType =
      typeof wire.diaperContent === 'string' ? wire.diaperContent.toLowerCase() : '';
    if (
      diaperType !== 'dry' &&
      diaperType !== 'wet' &&
      diaperType !== 'dirty' &&
      diaperType !== 'mixed'
    )
      throw invalid('The diaper category is unsupported.');
    return { ...base, kind, diaperType };
  }
  if (kind === 'medicine') {
    if (wire.comment !== undefined && wire.comment !== null && typeof wire.comment !== 'string')
      throw invalid('The medicine note is unsupported.');
    let note = String(wire.comment ?? '');
    try {
      note = decodeURIComponent(note);
    } catch {
      /* Retain legacy plain text. */
    }
    return { ...base, kind, note };
  }
  return { ...base, kind };
}
