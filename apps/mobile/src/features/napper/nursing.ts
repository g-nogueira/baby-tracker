import { type Breast, type Json, NapperError, object, type WireLog } from './contracts';
import { localTimestamp } from './client';

export interface NursingLog {
  wire: WireLog;
  id: string;
  start: string;
  end: string;
  open: boolean;
  last: Breast | null;
  left: number;
  right: number;
  pauses: readonly { start: number; end: number | null; wire: WireLog }[];
}
const writableFields = [
  'id',
  'category',
  'start',
  'end',
  'comment',
  'startMinutesAfterMidnight',
  'overallHappiness',
  'babyMoodOnWakeUp',
  'diaperWeight',
  'diaperContent',
  'feedingAmount',
  'amountPumpedLeft',
  'amountPumpedRight',
  'bottleFeedingType',
  'isOpen',
  'breastLeftMinutes',
  'breastRightMinutes',
  'activeBreast',
  'temperature',
  'pauses',
  'createdByUserId',
  'howBabySlept',
  'howBabyWoke',
  'babyMoodOnSleep',
  'timeToFallAsleep',
];
class NursingReadError extends NapperError {
  constructor(public readonly reason: string) {
    super('invalid', `This Nursing record could not be read. ${reason}`);
  }
}
// Only fixed explanations cross the UI boundary, never wire values or response bodies.
export const nursingReadReason = (error: unknown): string =>
  error instanceof NursingReadError ? error.reason : 'The record format is unsupported.';
const invalid = (reason = 'The record format is unsupported.') => new NursingReadError(reason);
function timestamp(value: unknown): number {
  const time =
    typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) throw invalid('A timestamp is missing or invalid.');
  return time;
}
function seconds(value: Json | undefined): number {
  if (value === null || value === undefined) return 0;
  // Napper's pause editor adds/subtracts millisecond intervals divided by 1000,
  // so these seconds-valued fields can contain fractional seconds.
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value > Number.MAX_SAFE_INTEGER ||
    value < 0
  )
    throw invalid('A breast duration is invalid.');
  return value;
}
export function readNursing(wire: WireLog): NursingLog {
  if (
    wire.category !== 'NURSING' ||
    typeof wire.id !== 'string' ||
    typeof wire.isOpen !== 'boolean'
  )
    throw invalid();
  if (typeof wire.start !== 'string') throw invalid('Start is missing or invalid.');
  if (typeof wire.end !== 'string') throw invalid('End is missing or invalid.');
  const start = timestamp(wire.start);
  const end = timestamp(wire.end);
  if (wire.isOpen !== true && end < start) throw invalid('End is earlier than Start.');
  const raw = wire.pauses ?? [];
  if (!Array.isArray(raw)) throw invalid('The pause list has an unsupported format.');
  let previous = start;
  const pauses = raw.map((entry, index) => {
    const row = object(entry) as WireLog;
    const at = timestamp(row.start);
    const until = row.end === null || row.end === undefined ? null : timestamp(row.end);
    if (
      at < previous ||
      (until !== null && until < at) ||
      (until === null && (!wire.isOpen || index !== raw.length - 1))
    )
      throw invalid('Pauses overlap, are out of order, or contain an invalid open pause.');
    previous = until ?? at;
    return { start: at, end: until, wire: row };
  });
  if (
    wire.activeBreast !== undefined &&
    wire.activeBreast !== null &&
    wire.activeBreast !== 'LEFT' &&
    wire.activeBreast !== 'RIGHT'
  )
    throw invalid('The active breast is unsupported.');
  const last =
    wire.activeBreast === 'LEFT' || wire.activeBreast === 'RIGHT' ? wire.activeBreast : null;
  if (wire.isOpen && last === null) throw invalid('The running feed has no active breast.');
  if (!wire.isOpen && pauses.some((p) => p.start > end || (p.end ?? end) > end))
    throw invalid('A pause extends beyond the completed feed.');
  return {
    wire,
    id: wire.id,
    start: wire.start,
    end: wire.end,
    open: wire.isOpen,
    last,
    left: seconds(wire.breastLeftMinutes),
    right: seconds(wire.breastRightMinutes),
    pauses,
  };
}
export function nursingTotals(log: NursingLog, now: Date) {
  const through = log.open ? now.getTime() : timestamp(log.end);
  const start = timestamp(log.start);
  if (through < start) throw invalid('Start is later than the current time.');
  const pauseMs = log.pauses.reduce(
    (sum, pause) => sum + Math.max(0, Math.min(through, pause.end ?? through) - pause.start),
    0,
  );
  const pause = Math.round(pauseMs / 1000);
  const total = Math.round((through - start - pauseMs) / 1000);
  if (total < 0) throw invalid('Pause time exceeds the feed duration.');
  if (!log.open)
    return { left: log.left, right: log.right, total: log.left + log.right, pause, paused: false };
  const other = log.last === 'LEFT' ? log.right : log.left;
  // Match Napper: round after subtracting the inactive side, retaining its exact
  // stored value. Rounding the elapsed time first can add a second after reopening.
  const current = Math.round((through - start - pauseMs) / 1000 - other);
  if (current < 0) throw invalid('A breast duration exceeds the available active time.');
  return {
    left: log.last === 'LEFT' ? current : log.left,
    right: log.last === 'RIGHT' ? current : log.right,
    total: current + other,
    pause,
    paused: log.pauses.some((p) => p.end === null),
  };
}
/** Sends only fields used by Napper's SDK, retaining all existing writable metadata. */
export function nursingRequest(log: WireLog): WireLog {
  return Object.fromEntries(
    writableFields.filter((field) => log[field] !== undefined).map((field) => [field, log[field]]),
  );
}
export function startNapperNursing(
  id: string,
  side: Breast,
  userId: string,
  at: Date,
  now: Date,
): WireLog {
  if (!id.endsWith('_NURSING') || !Number.isFinite(at.getTime()) || at > now) throw invalid();
  const start = localTimestamp(at);
  return {
    id,
    category: 'NURSING',
    start,
    end: start,
    comment: '',
    isOpen: true,
    breastLeftMinutes: 0,
    breastRightMinutes: 0,
    activeBreast: side,
    createdByUserId: userId,
  };
}
export type NursingCommand =
  | { kind: 'switch' | 'resume'; side: Breast }
  | { kind: 'pause' | 'stop' };
/** Accrues by instants, never by timer ticks. The pause representation mirrors the observed SDK. */
export function changeNapperNursing(log: NursingLog, command: NursingCommand, now: Date): WireLog {
  if (!log.open)
    throw new NapperError('conflict', 'This feed has already stopped. Refresh its record.');
  const totals = nursingTotals(log, now);
  const pauses = log.pauses.map((p) => ({ ...p.wire }));
  let end = log.end;
  let side = log.last;
  let open = true;
  if (command.kind === 'pause') {
    if (totals.paused) throw new NapperError('conflict', 'This feed is already paused.');
    pauses.push({ breast: side, start: now.getTime(), end: null });
  }
  if (command.kind === 'resume' || command.kind === 'switch') {
    if (command.kind === 'resume' && !totals.paused)
      throw new NapperError('conflict', 'This feed is already running.');
    const last = pauses.at(-1);
    if (totals.paused && last) last.end = now.getTime();
    side = command.side;
  }
  if (command.kind === 'stop') {
    open = false;
    const last = log.pauses.at(-1);
    if (last?.end === null) {
      end = localTimestamp(new Date(last.start));
      pauses.pop();
    } else end = localTimestamp(now);
  }
  return nursingRequest({
    ...log.wire,
    end,
    isOpen: open,
    activeBreast: side,
    breastLeftMinutes: totals.left,
    breastRightMinutes: totals.right,
    ...(pauses.length || log.wire.pauses !== undefined ? { pauses } : {}),
  });
}
export function correctNapperNursing(
  log: NursingLog,
  start: Date,
  end: Date,
  left: number,
  last: Breast,
  now: Date,
): WireLog {
  if (log.open)
    throw new NapperError('invalid', 'Stop this feed before editing its completed split.');
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start > end ||
    end > now ||
    log.pauses.some((p) => p.start < start.getTime() || (p.end ?? end.getTime()) > end.getTime())
  )
    throw new NapperError(
      'invalid',
      'Keep Start and End around the existing pauses and in the past.',
    );
  const pause = log.pauses.reduce((sum, p) => sum + ((p.end ?? p.start) - p.start), 0);
  const total = Math.round((end.getTime() - start.getTime() - pause) / 1000);
  if (
    !Number.isSafeInteger(left) ||
    left < 0 ||
    left > total ||
    (total > 0 && (last === 'LEFT' ? left === 0 : left === total))
  )
    throw new NapperError('invalid', 'Left time must fit within the total active feed time.');
  return nursingRequest({
    ...log.wire,
    start: localTimestamp(start),
    end: localTimestamp(end),
    breastLeftMinutes: left,
    breastRightMinutes: total - left,
    activeBreast: last,
  });
}
