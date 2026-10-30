import type { CareCommand } from '@/features/care-service/contracts';
import { CareServiceError } from '@/features/care-service/contracts';
import { object, type WireLog } from './contracts';
import { instant, readSleepPauses, zonedTimestamp } from './care-records';

/** Retain provider-only pause metadata by opaque reference; validate the complete replacement. */
export function editSleep(
  log: WireLog,
  command: Extract<CareCommand, { type: 'edit-sleep' }>,
  now: Date,
  timezone: string,
): WireLog {
  const fail = (message: string): never => {
    throw new CareServiceError('invalid', message);
  };
  if (log.category !== 'NAP' && log.category !== 'NIGHT_WAKING')
    fail('Only sleep intervals have pauses.');
  const start = instant(command.startedAt);
  const end = command.endedAt === null ? null : instant(command.endedAt);
  if (
    Date.parse(start) > now.getTime() ||
    (end && (Date.parse(end) > now.getTime() || end <= start))
  )
    fail('Choose a valid sleep interval in the past.');
  if (log.isOpen === false && end === null) fail('Use Continue Nap to reopen a completed nap.');
  const original = Array.isArray(log.pauses) ? log.pauses : [];
  const used = new Set<string>();
  const pauses = command.pauses.map((pause) => {
    let metadata: WireLog = {};
    if (pause.id !== undefined) {
      if (used.has(pause.id) || !/^pause:\d+$/.test(pause.id))
        fail('A pause reference is invalid. Refresh this activity.');
      used.add(pause.id);
      const index = Number(pause.id.slice(6));
      if (pause.id !== `pause:${index}` || index >= original.length)
        fail('A pause changed. Refresh this activity.');
      metadata = object(original[index]) as WireLog;
    }
    return {
      ...metadata,
      start: Date.parse(instant(pause.startedAt)),
      end: pause.endedAt === null ? null : Date.parse(instant(pause.endedAt)),
    };
  });
  const result: WireLog = {
    ...log,
    start: zonedTimestamp(new Date(start), timezone),
    end: zonedTimestamp(new Date(end ?? start), timezone),
    isOpen: end === null,
    pauses,
  };
  readSleepPauses(result, now);
  return result;
}
