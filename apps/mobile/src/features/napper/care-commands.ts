import { applyActivityDetails } from './care-details';
import { calendarDayForInstant, shiftCalendarDay } from '@/features/naps/calendar-day';
import {
  assertSleepContext,
  byStart,
  sleepBoundaryAt,
  sleepKinds,
} from '@/features/care-service/sleep-state';
import {
  CareServiceError,
  type CareActivity,
  type CareCommand,
  type CareKind,
  type PastActivity,
} from '@/features/care-service/contracts';
import { fingerprint, object, type WireLog } from './contracts';
import { sleepConflicts } from '@/features/care-service/sleep-conflicts';
import {
  bedtimeFields,
  categories,
  instant,
  kindForCategory,
  readCareRecord,
  readSleepPauses,
  zonedTimestamp,
} from './care-records';
import { correctNapperNursing, nursingTotals, readNursing } from './nursing';

function fail(message: string): never {
  throw new CareServiceError('conflict', message);
}
const time = (value: string, now: Date) => {
  const at = new Date(instant(value));
  if (at > now) fail('Choose a time in the past.');
  return at;
};
function relevant(logs: WireLog[], now: Date, kinds: ReadonlySet<string>): CareActivity[] {
  return logs
    .filter((log) => kinds.has(kindForCategory(log.category) ?? '') && log.skipped !== true)
    .flatMap((log) => {
      const record = readCareRecord(log, 'validation', now);
      return record ? [record] : [];
    });
}
function assertNoOverlap(intervals: CareActivity[]) {
  const sorted = intervals.sort(byStart);
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1];
    if (!previous.endedAt || previous.endedAt > sorted[i].startedAt)
      fail('This time overlaps another activity of the same type.');
  }
}
/** Reject new conflicts and conflicts involving the edited records, not unrelated old history. */
export function validateCareSleep(
  before: WireLog[],
  after: WireLog[],
  requests: WireLog[],
  now: Date,
) {
  assertSleepContext(relevant(after, now, sleepKinds));
  const existing = new Set(sleepConflicts(relevant(before, now, sleepKinds)).map((v) => v.key));
  const changed = new Set(requests.map((r) => String(r.id)));
  for (const violation of sleepConflicts(relevant(after, now, sleepKinds)))
    if (!existing.has(violation.key) || violation.ids.some((id) => changed.has(id)))
      fail(violation.message);
}
/** Stopping a paused timer ends at the pause start, matching the observed timer contract. */
function closeSleep(log: WireLog, at: Date, now: Date, timezone: string): WireLog {
  const pauses = readSleepPauses(log, now);
  const last = pauses.at(-1);
  if (last?.end === null) {
    if (at.getTime() < last.start) fail('Stop must not precede the current pause.');
    return {
      ...log,
      isOpen: false,
      end: zonedTimestamp(new Date(last.start), timezone),
      pauses: Array.isArray(log.pauses) ? log.pauses.slice(0, -1) : [],
    };
  }
  return { ...log, isOpen: false, end: zonedTimestamp(at, timezone) };
}
function newLog(
  kind: CareKind,
  at: Date,
  open: boolean,
  id: () => string,
  user: string,
  timezone: string,
): WireLog {
  return {
    id: `LOG_${id()}_${categories[kind]}`,
    category: categories[kind],
    start: zonedTimestamp(at, timezone),
    end: zonedTimestamp(at, timezone),
    ...(kind === 'bedtime' ? bedtimeFields(at, timezone) : {}),
    isOpen: open,
    comment: '',
    createdByUserId: user,
  };
}
function pastLog(
  activity: PastActivity,
  now: Date,
  id: () => string,
  user: string,
  timezone: string,
) {
  const at = time(activity.startedAt, now);
  const log = newLog(activity.kind, at, false, id, user, timezone);
  if ('endedAt' in activity && activity.endedAt !== undefined) {
    const end = time(activity.endedAt, now);
    if (
      end < at ||
      (activity.kind !== 'nursing' && activity.kind !== 'bedtime' && end.getTime() === at.getTime())
    )
      fail('End must be after Start.');
    log.end = zonedTimestamp(end, timezone);
  }
  if (activity.kind === 'diaper') log.diaperContent = activity.diaperType.toUpperCase();
  if (activity.kind === 'medicine') log.comment = encodeURIComponent(activity.note);
  if (activity.kind === 'nursing') {
    Object.assign(log, {
      breastLeftMinutes: 0,
      breastRightMinutes: 0,
      activeBreast: activity.lastBreast,
    });
    return applyActivityDetails(
      correctNapperNursing(
        readNursing(log),
        at,
        time(activity.endedAt, now),
        activity.leftSeconds,
        activity.lastBreast,
        now,
      ),
      activity.details,
    );
  }
  return applyActivityDetails(log, activity.details);
}
/** Pure command planning; the tracker owns preflight reads, locking, writes and confirmation. */
export function prepareCareWrites(
  logs: WireLog[],
  command: CareCommand,
  expected: WireLog | null,
  now: Date,
  id: () => string,
  user: string,
  timezone: string,
): WireLog[] {
  if ('expected' in command) {
    const actual = logs.find((log) => log.id === command.expected.id);
    if (!expected || !actual || fingerprint(actual) !== fingerprint(expected))
      fail('This activity changed in the shared service. Refresh and review it before saving.');
    expected = actual;
  }
  const records = relevant(logs, now, sleepKinds);
  const state = assertSleepContext(records);
  const at = 'at' in command ? time(command.at, now) : null;
  const liveAt = () => {
    if (
      !at ||
      calendarDayForInstant(at, timezone) <
        shiftCalendarDay(calendarDayForInstant(now, timezone), -1)
    )
      fail(
        'A live activity must start today or yesterday. Use Add past activity for older records.',
      );
    return at;
  };
  let requests: WireLog[];
  switch (command.type) {
    case 'bedtime':
    case 'start-nap': {
      if (state.night || state.nap || state.waking)
        fail('Sleep is already active. Open its controls instead.');
      if (state.boundary && at && at.toISOString() <= state.boundary.startedAt)
        fail('Start must follow the last Wake up.');
      requests = [
        newLog(
          command.type === 'bedtime' ? 'bedtime' : 'nap',
          liveAt(),
          command.type === 'start-nap',
          id,
          user,
          timezone,
        ),
      ];
      break;
    }
    case 'start-night-waking':
    case 'wake-up': {
      if (!state.night || state.night.id !== expected?.id || !at)
        fail('The active night changed. Refresh and review its current state.');
      if (at.toISOString() <= sleepBoundaryAt(state.night))
        fail('The transition must follow bedtime.');
      if (command.type === 'start-night-waking') {
        if (state.waking) fail('A night waking is already running.');
        requests = [newLog('night-waking', at, true, id, user, timezone)];
      } else {
        requests = [];
        if (state.waking) {
          const waking = logs.find((l) => l.id === state.waking?.id);
          if (!waking) fail('The running night waking changed. Refresh its record.');
          requests.push(closeSleep(waking, at, now, timezone));
        }
        requests.push(newLog('wake-up', at, false, id, user, timezone));
      }
      break;
    }
    case 'stop-nap':
    case 'fall-asleep': {
      const current = command.type === 'stop-nap' ? state.nap : state.waking;
      if (!current || !expected || current.id !== expected.id || !at)
        fail('This sleep activity is no longer running. Refresh its record.');
      requests = [closeSleep(expected, at, now, timezone)];
      break;
    }
    case 'pause-nap':
    case 'resume-nap': {
      if (!state.nap || state.nap.id !== expected?.id || !expected || !at)
        fail('This nap is no longer running. Refresh its record.');
      const pauses = Array.isArray(expected.pauses) ? expected.pauses : [];
      const last = readSleepPauses(expected, now).at(-1);
      if (command.type === 'pause-nap') {
        if (state.nap.status !== 'active') fail('This nap is already paused.');
        requests = [{ ...expected, pauses: [...pauses, { start: at.getTime(), end: null }] }];
      } else {
        if (state.nap.status !== 'paused' || !last || at.getTime() < last.start)
          fail('This nap is no longer paused, or Resume precedes its pause.');
        requests = [
          {
            ...expected,
            pauses: [
              ...pauses.slice(0, -1),
              ...(at.getTime() === last.start
                ? []
                : [{ ...object(pauses.at(-1)), end: at.getTime() }]),
            ],
          },
        ];
      }
      break;
    }
    case 'continue-nap': {
      if (expected?.category !== 'NAP' || expected.isOpen !== false || !at)
        fail('Only a completed nap can be continued.');
      if (state.nap || state.night || state.waking)
        fail('Another sleep activity is already running.');
      const end = Date.parse(String(expected.end));
      if (at.getTime() < end || now.getTime() - end > 3600000)
        fail('A nap can be continued within one hour of stopping.');
      const pauses = Array.isArray(expected.pauses) ? expected.pauses : [];
      requests = [
        {
          ...expected,
          isOpen: true,
          end: expected.start,
          pauses: [...pauses, { start: end, end: at.getTime() }],
        },
      ];
      break;
    }
    case 'edit-activity': {
      if (!expected) fail('Refresh this activity before editing it.');
      const start = time(command.startedAt, now);
      const kind = kindForCategory(expected.category);
      if (!kind) fail('This activity type is unsupported.');
      if (kind === 'nursing' && expected.isOpen !== true)
        fail('Use Nursing controls to edit a completed feed.');
      const request: WireLog = { ...expected, start: zonedTimestamp(start, timezone) };
      if (kind === 'bedtime') {
        const previous = readCareRecord(expected, 'validation', now);
        if (!previous) fail('The bedtime could not be read.');
        const delta = start.getTime() - Date.parse(previous.startedAt);
        Object.assign(request, bedtimeFields(start, timezone), {
          end: zonedTimestamp(
            command.endedAt
              ? time(command.endedAt, now)
              : time(new Date(Date.parse(String(expected.end)) + delta).toISOString(), now),
            timezone,
          ),
        });
      } else if (kind === 'nap' || kind === 'night-waking') {
        if (expected.isOpen === false) {
          if (!command.endedAt) fail('Choose an End time.');
          request.end = zonedTimestamp(time(command.endedAt, now), timezone);
        }
      } else request.end = request.start;
      if (kind === 'nursing') {
        request.end = expected.end;
        nursingTotals(readNursing(request), now);
      }
      if (kind === 'diaper' && command.diaperType)
        request.diaperContent = command.diaperType.toUpperCase();
      if (kind === 'medicine' && command.note !== undefined)
        request.comment = encodeURIComponent(command.note);
      requests = [request];
      break;
    }
    case 'record-past':
      requests = [pastLog(command.activity, now, id, user, timezone)];
      break;
    default:
      throw new CareServiceError('invalid', 'Use Nursing controls for this action.');
  }
  if ('details' in command && command.details) {
    // Wake up can also close a running waking: annotations belong to the newly requested boundary.
    const target = requests.at(-1);
    if (target) applyActivityDetails(target, command.details);
  }
  const replacements = new Map(requests.map((r) => [r.id, r]));
  const after = [...logs.filter((l) => !replacements.has(l.id)), ...requests];
  if (requests.some((r) => sleepKinds.has(kindForCategory(r.category) ?? '')))
    validateCareSleep(logs, after, requests, now);
  if (requests.some((r) => r.category === 'NURSING'))
    assertNoOverlap(relevant(after, now, new Set(['nursing'])));
  // Validate every prepared record, including diaper enums, times and pause bounds.
  requests.forEach((r) => {
    readCareRecord(r, 'validation', now);
  });
  return requests;
}
