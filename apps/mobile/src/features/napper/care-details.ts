import type { ActivityDetails, SleepMethod, WakeMood } from '@/features/care-service/contracts';
import { CareServiceError } from '@/features/care-service/contracts';
import type { WireLog } from './contracts';

const methods: Record<SleepMethod, string> = {
  'in-bed': 'IN_BED',
  nursing: 'NURSING',
  held: 'WORN_OR_HELD',
  'next-to-me': 'NEXT_TO_ME',
  bottle: 'BOTTLE',
  stroller: 'STROLLER',
  car: 'CAR',
  swing: 'SWING',
};
const settling = { 'took-long': 'LONG_TIME_TO_FALL_ASLEEP', upset: 'UPSET' } as const;
const moods: Record<WakeMood, string> = { bad: 'BAD', neutral: 'NEUTRAL', good: 'GOOD' };

/** Unknown provider metadata is retained by command merging, never echoed back as guessed enums. */
export function readActivityDetails(log: WireLog): ActivityDetails | undefined {
  const details: ActivityDetails = {};
  if (Array.isArray(log.babyMoodOnSleep))
    details.settling = (Object.keys(settling) as (keyof typeof settling)[]).filter((k) =>
      (log.babyMoodOnSleep as unknown[]).includes(settling[k]),
    );
  const method = (Object.keys(methods) as SleepMethod[]).find(
    (k) => methods[k] === log.howBabySlept,
  );
  if (method) details.sleepMethod = method;
  const mood = (Object.keys(moods) as WakeMood[]).find((k) => moods[k] === log.babyMoodOnWakeUp);
  if (mood) details.wakeMood = mood;
  if (typeof log.comment === 'string' && log.comment) {
    try {
      details.comment = decodeURIComponent(log.comment);
    } catch {
      details.comment = log.comment;
    }
  }
  return Object.keys(details).length ? details : undefined;
}

/** Apply only explicit draft fields so unrelated/unknown metadata survives edits. */
export function applyActivityDetails(log: WireLog, patch?: ActivityDetails): WireLog {
  if (!patch) return log;
  const invalid = () => {
    throw new CareServiceError('invalid', 'Choose supported activity details.');
  };
  if (patch.settling !== undefined) {
    if (!Array.isArray(patch.settling) || patch.settling.some((v) => !Object.hasOwn(settling, v)))
      invalid();
    log.babyMoodOnSleep = [...new Set(patch.settling)].map((v) => settling[v]);
  }
  if (patch.sleepMethod !== undefined) {
    if (patch.sleepMethod !== null && !Object.hasOwn(methods, patch.sleepMethod)) invalid();
    log.howBabySlept = patch.sleepMethod === null ? null : methods[patch.sleepMethod];
  }
  if (patch.wakeMood !== undefined) {
    if (patch.wakeMood !== null && !Object.hasOwn(moods, patch.wakeMood)) invalid();
    log.babyMoodOnWakeUp = patch.wakeMood === null ? null : moods[patch.wakeMood];
  }
  if (patch.comment !== undefined) {
    if (typeof patch.comment !== 'string') invalid();
    log.comment = encodeURIComponent(patch.comment);
  }
  return log;
}
