import { assertValidSleepSession } from './sleep';
import type { NightSleepSession, SleepSession, UtcInstant } from './types';

export const CYCLE_HORIZON_MS = 24 * 60 * 60 * 1_000;
export const CYCLE_START_ANGLE_DEGREES = 225;
export const CYCLE_SWEEP_ANGLE_DEGREES = 270;

export type CycleKind = 'day' | 'night' | 'unanchored_day';
export type CycleBoundaryKind = 'bedtime' | 'local_midnight' | 'wake_up';

export interface CanonicalCycleAnchor {
  kind: Exclude<CycleBoundaryKind, 'local_midnight'>;
  recordId: string;
  at: UtcInstant;
}

export interface UnanchoredCycleAnchor {
  kind: 'local_midnight';
  recordId: null;
  at: UtcInstant;
  label: 'Unanchored day';
}

export type CycleAnchor = CanonicalCycleAnchor | UnanchoredCycleAnchor;

export type CycleIdentity =
  | { kind: 'night'; nightSessionId: string }
  | { kind: 'day'; precedingNightSessionId: string; wakeUpAt: UtcInstant }
  | { kind: 'unanchored_day'; localDate: string; timezone: string };

interface CycleBase {
  id: string;
  identity: CycleIdentity;
  kind: CycleKind;
  startedAt: UtcInstant;
  endedAt: UtcInstant | null;
  timezone: string;
  startAnchor: CycleAnchor | null;
  endAnchor: CycleAnchor | null;
}

export interface NightCycle extends CycleBase {
  kind: 'night';
  identity: Extract<CycleIdentity, { kind: 'night' }>;
  sourceNightSessionId: string;
  startAnchor: CanonicalCycleAnchor;
}

export interface DayCycle extends CycleBase {
  kind: 'day';
  identity: Extract<CycleIdentity, { kind: 'day' }>;
  precedingNightSessionId: string;
  nextNightSessionId: string | null;
  startAnchor: CanonicalCycleAnchor;
}

export interface UnanchoredDayCycle extends CycleBase {
  kind: 'unanchored_day';
  identity: Extract<CycleIdentity, { kind: 'unanchored_day' }>;
  localDate: string;
  endedAt: UtcInstant;
  startAnchor: UnanchoredCycleAnchor;
  endAnchor: null;
}

export type Cycle = NightCycle | DayCycle | UnanchoredDayCycle;

type CompletedNightSleepSession = NightSleepSession & {
  status: 'completed';
  endedAt: UtcInstant;
};

export interface EmptyNightCycle {
  id: string;
  kind: 'empty_night';
  localDate: string;
  timezone: string;
  label: 'No night sleep logged';
}

export interface ResolveCanonicalCyclesOptions {
  childId: string;
  localDate: string;
  timezone: string;
}

export interface ResolvedCanonicalCycles {
  day: DayCycle | UnanchoredDayCycle;
  night: NightCycle | EmptyNightCycle;
}

export interface CycleIntervalRecord {
  type: 'interval';
  id: string;
  lane: string;
  startedAt: UtcInstant;
  endedAt: UtcInstant | null;
}

export interface CyclePointRecord {
  type: 'point';
  id: string;
  lane: string;
  occurredAt: UtcInstant;
}

export type CycleRecord = CycleIntervalRecord | CyclePointRecord;

export type ProjectionOverflow = 'after_horizon' | 'before_start' | null;

export interface ProjectedInstant {
  at: UtcInstant;
  elapsedMs: number;
  clampedElapsedMs: number;
  angleDegrees: number;
  overflow: ProjectionOverflow;
  overflowMs: number;
}

export type ProjectedCycleAnchor = CycleAnchor & {
  boundary: 'end' | 'start';
  projection: ProjectedInstant;
};

export interface CollisionOffset {
  clusterIndex: number;
  clusterSize: number;
  offsetSteps: number;
  radialOffset: number;
  labelOffset: number;
}

export interface ProjectedRecordToken {
  recordId: string;
  lane: string;
  projection: ProjectedInstant;
  collision: CollisionOffset;
}

export interface ProjectedRecordArc {
  startedAt: UtcInstant;
  endedAt: UtcInstant;
  start: ProjectedInstant;
  end: ProjectedInstant;
  actualDurationMs: number;
  visibleDurationMs: number;
  active: boolean;
  clippedAtCycleStart: boolean;
  clippedAtCycleEnd: boolean;
}

export interface ProjectedCycleRecord {
  id: string;
  lane: string;
  type: CycleRecord['type'];
  ownership: 'continuation' | 'primary';
  token: ProjectedRecordToken | null;
  arc: ProjectedRecordArc | null;
}

export interface CycleOverflow {
  hasOverflow: boolean;
  durationMs: number;
  overflowMs: number;
  horizonEndedAt: UtcInstant;
}

export interface CycleProjection {
  cycle: Cycle;
  observedEndedAt: UtcInstant;
  anchors: readonly ProjectedCycleAnchor[];
  records: readonly ProjectedCycleRecord[];
  overflow: CycleOverflow;
}

export interface ProjectCycleOptions {
  now: Date;
  collisionAngleDegrees?: number;
  collisionRadialStep?: number;
  collisionLabelStep?: number;
}

export interface CycleTick {
  offsetMs: number;
  at: UtcInstant;
  angleDegrees: number;
  label: string;
}

export interface CycleTickOptions {
  offsetsMs?: readonly number[];
  locale?: string;
}

export interface CollisionCandidate {
  recordId: string;
  lane: string;
  angleDegrees: number;
}

export interface CollisionPlacement extends CollisionCandidate {
  collision: CollisionOffset;
}

export interface CollisionOptions {
  minimumAngleDegrees?: number;
  radialStep?: number;
  labelStep?: number;
}

const DEFAULT_TICK_OFFSETS_MS = [0, 3, 6, 9, 12, 15, 18, 21, 24].map(
  (hours) => hours * 60 * 60 * 1_000,
);

/** Uses the canonical Night session ID and Bedtime/Wake-up boundaries unchanged. */
export function createNightCycle(session: NightSleepSession): NightCycle {
  assertProjectableNight(session);

  return {
    id: session.id,
    identity: { kind: 'night', nightSessionId: session.id },
    kind: 'night',
    sourceNightSessionId: session.id,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    timezone: session.timezone,
    startAnchor: { kind: 'bedtime', recordId: session.id, at: session.startedAt },
    endAnchor:
      session.endedAt === null
        ? null
        : { kind: 'wake_up', recordId: session.id, at: session.endedAt },
  };
}

/** Resolves the Day beginning on a local date and the first canonical Night that follows it. */
export function resolveCanonicalCycles(
  sessions: readonly SleepSession[],
  options: ResolveCanonicalCyclesOptions,
): ResolvedCanonicalCycles {
  assertLocalDate(options.localDate);
  assertTimezone(options.timezone);
  const localStartedAt = localMidnightUtc(options.localDate, options.timezone);
  const localEndedAt = localMidnightUtc(shiftLocalDate(options.localDate, 1), options.timezone);
  const localStartMs = instantMs(localStartedAt, 'local day start');
  const localEndMs = instantMs(localEndedAt, 'local day end');
  const nights = sessions
    .filter(
      (session): session is NightSleepSession =>
        session.kind === 'night' &&
        session.childId === options.childId &&
        session.deletedAt === null,
    )
    .map((session) => {
      assertProjectableNight(session);
      return session;
    });

  const precedingNight = nights
    .filter((session): session is CompletedNightSleepSession => {
      if (session.status !== 'completed' || session.endedAt === null) return false;
      const wakeUpMs = instantMs(session.endedAt, 'Night Wake up');
      return wakeUpMs >= localStartMs && wakeUpMs < localEndMs;
    })
    .sort(compareNightsByWakeUpDescending)[0];

  if (precedingNight !== undefined) {
    const wakeUpMs = instantMs(precedingNight.endedAt, 'Night Wake up');
    const nextNight = nights
      .filter(
        (session) =>
          session.id !== precedingNight.id &&
          instantMs(session.startedAt, 'Night Bedtime') >= wakeUpMs,
      )
      .sort(compareNightsByBedtime)[0];
    return {
      day: createDayCycle(precedingNight, nextNight ?? null),
      night:
        nextNight === undefined
          ? createEmptyNightCycle(options.localDate, options.timezone)
          : createNightCycle(nextNight),
    };
  }

  const firstNight = nights
    .filter((session) => {
      const bedtimeMs = instantMs(session.startedAt, 'Night Bedtime');
      return bedtimeMs >= localStartMs && bedtimeMs < localEndMs;
    })
    .sort(compareNightsByBedtime)[0];
  return {
    day: createUnanchoredDayCycle(options.localDate, options.timezone),
    night:
      firstNight === undefined
        ? createEmptyNightCycle(options.localDate, options.timezone)
        : createNightCycle(firstNight),
  };
}

/** Creates the half-open Day interval between a real Wake up and the next real Bedtime. */
export function createDayCycle(
  precedingNight: NightSleepSession,
  nextNight: NightSleepSession | null = null,
): DayCycle {
  assertProjectableNight(precedingNight);
  if (precedingNight.endedAt === null || precedingNight.status !== 'completed') {
    throw new Error('A Day cycle requires a completed preceding Night Wake up.');
  }
  if (nextNight !== null) {
    assertProjectableNight(nextNight);
    if (nextNight.childId !== precedingNight.childId) {
      throw new Error('Day cycle boundaries must belong to the same child.');
    }
    if (instantMs(nextNight.startedAt, 'next Night Bedtime') < instantMs(precedingNight.endedAt)) {
      throw new Error('The next Night Bedtime cannot precede the Day Wake up.');
    }
  }

  const wakeUpAt = precedingNight.endedAt;
  return {
    id: `day:${precedingNight.id}:${wakeUpAt}`,
    identity: { kind: 'day', precedingNightSessionId: precedingNight.id, wakeUpAt },
    kind: 'day',
    precedingNightSessionId: precedingNight.id,
    nextNightSessionId: nextNight?.id ?? null,
    startedAt: wakeUpAt,
    endedAt: nextNight?.startedAt ?? null,
    timezone: precedingNight.timezone,
    startAnchor: { kind: 'wake_up', recordId: precedingNight.id, at: wakeUpAt },
    endAnchor:
      nextNight === null
        ? null
        : { kind: 'bedtime', recordId: nextNight.id, at: nextNight.startedAt },
  };
}

/** Keeps legacy data visible under an explicit local-calendar-day identity, without a fake anchor. */
export function createUnanchoredDayCycle(localDate: string, timezone: string): UnanchoredDayCycle {
  assertLocalDate(localDate);
  assertTimezone(timezone);
  const nextLocalDate = shiftLocalDate(localDate, 1);
  const startedAt = localMidnightUtc(localDate, timezone);
  const endedAt = localMidnightUtc(nextLocalDate, timezone);

  return {
    id: `unanchored-day:${timezone}:${localDate}`,
    identity: { kind: 'unanchored_day', localDate, timezone },
    kind: 'unanchored_day',
    localDate,
    startedAt,
    endedAt,
    timezone,
    startAnchor: {
      kind: 'local_midnight',
      recordId: null,
      at: startedAt,
      label: 'Unanchored day',
    },
    endAnchor: null,
  };
}

/** Represents the explicit empty state without manufacturing Bedtime or Wake-up instants. */
export function createEmptyNightCycle(localDate: string, timezone: string): EmptyNightCycle {
  assertLocalDate(localDate);
  assertTimezone(timezone);
  return {
    id: `empty-night:${timezone}:${localDate}`,
    kind: 'empty_night',
    localDate,
    timezone,
    label: 'No night sleep logged',
  };
}

/** Projects canonical records onto a fixed 24-real-hour, 270-degree track. */
export function projectCycle(
  cycle: Cycle,
  records: readonly CycleRecord[],
  options: ProjectCycleOptions,
): CycleProjection {
  assertUniqueRecordIds(records);
  const cycleStartMs = instantMs(cycle.startedAt, 'cycle start');
  const nowMs = options.now.getTime();
  if (Number.isNaN(nowMs)) throw new Error('A valid projection time is required.');
  if (cycle.endedAt === null && nowMs < cycleStartMs) {
    throw new Error('An active cycle cannot be projected before it starts.');
  }
  const observedEndMs = cycle.endedAt === null ? nowMs : instantMs(cycle.endedAt, 'cycle end');
  if (observedEndMs < cycleStartMs) throw new Error('A cycle cannot end before it starts.');

  const candidates: Array<{
    record: CycleRecord;
    ownership: 'continuation' | 'primary';
    tokenAtMs: number | null;
    arc: ProjectedRecordArc | null;
  }> = [];
  const canonicalEndMs = cycle.endedAt === null ? null : instantMs(cycle.endedAt, 'cycle end');

  for (const record of records) {
    if (record.type === 'point') {
      const occurredAtMs = instantMs(record.occurredAt, 'point event');
      if (ownsStart(occurredAtMs, cycleStartMs, canonicalEndMs, nowMs)) {
        candidates.push({ record, ownership: 'primary', tokenAtMs: occurredAtMs, arc: null });
      }
      continue;
    }

    const recordStartMs = instantMs(record.startedAt, 'interval start');
    const recordEndMs = record.endedAt === null ? nowMs : instantMs(record.endedAt, 'interval end');
    if (record.endedAt !== null && recordEndMs <= recordStartMs) {
      throw new Error('A completed projected interval must end after it starts.');
    }
    if (record.endedAt === null && recordStartMs > nowMs) {
      throw new Error('An active projected interval cannot start after projection time.');
    }
    if (record.endedAt !== null && canonicalEndMs === null && recordEndMs > nowMs) {
      throw new Error('A completed projected interval cannot end after projection time.');
    }

    const primary = ownsStart(recordStartMs, cycleStartMs, canonicalEndMs, nowMs);
    const continuation = recordStartMs < cycleStartMs && recordEndMs > cycleStartMs;
    if (!primary && !continuation) continue;

    const visibleStartMs = Math.max(recordStartMs, cycleStartMs);
    const visibleEndMs = Math.min(recordEndMs, observedEndMs);
    if (visibleEndMs < visibleStartMs) continue;

    candidates.push({
      record,
      ownership: primary ? 'primary' : 'continuation',
      tokenAtMs: primary ? recordStartMs : null,
      arc: {
        startedAt: new Date(visibleStartMs).toISOString(),
        endedAt: new Date(visibleEndMs).toISOString(),
        start: projectInstant(cycle, new Date(visibleStartMs).toISOString()),
        end: projectInstant(cycle, new Date(visibleEndMs).toISOString()),
        actualDurationMs: Math.max(0, recordEndMs - recordStartMs),
        visibleDurationMs: visibleEndMs - visibleStartMs,
        active: record.endedAt === null,
        clippedAtCycleStart: recordStartMs < cycleStartMs,
        clippedAtCycleEnd: canonicalEndMs !== null && recordEndMs > canonicalEndMs,
      },
    });
  }

  const collisionPlacements = assignLaneCollisionOffsets(
    candidates.flatMap(({ record, tokenAtMs }) =>
      tokenAtMs === null
        ? []
        : [
            {
              recordId: record.id,
              lane: record.lane,
              angleDegrees: projectInstant(cycle, new Date(tokenAtMs).toISOString()).angleDegrees,
            },
          ],
    ),
    {
      ...(options.collisionAngleDegrees === undefined
        ? {}
        : { minimumAngleDegrees: options.collisionAngleDegrees }),
      ...(options.collisionRadialStep === undefined
        ? {}
        : { radialStep: options.collisionRadialStep }),
      ...(options.collisionLabelStep === undefined
        ? {}
        : { labelStep: options.collisionLabelStep }),
    },
  );
  const collisionByKey = new Map(
    collisionPlacements.map((placement) => [collisionKey(placement), placement.collision]),
  );

  const projectedRecords = candidates
    .map(({ record, ownership, tokenAtMs, arc }): ProjectedCycleRecord => {
      const projection =
        tokenAtMs === null ? null : projectInstant(cycle, new Date(tokenAtMs).toISOString());
      let token: ProjectedRecordToken | null = null;
      if (projection !== null) {
        const collision = collisionByKey.get(
          collisionKey({
            recordId: record.id,
            lane: record.lane,
            angleDegrees: projection.angleDegrees,
          }),
        );
        if (collision === undefined) {
          throw new Error('Every primary record token requires a collision placement.');
        }
        token = { recordId: record.id, lane: record.lane, projection, collision };
      }
      return {
        id: record.id,
        lane: record.lane,
        type: record.type,
        ownership,
        token,
        arc,
      };
    })
    .sort(compareProjectedRecords);

  const durationMs = observedEndMs - cycleStartMs;
  return {
    cycle,
    observedEndedAt: new Date(observedEndMs).toISOString(),
    anchors: projectAnchors(cycle),
    records: projectedRecords,
    overflow: {
      hasOverflow: durationMs > CYCLE_HORIZON_MS,
      durationMs,
      overflowMs: Math.max(0, durationMs - CYCLE_HORIZON_MS),
      horizonEndedAt: new Date(cycleStartMs + CYCLE_HORIZON_MS).toISOString(),
    },
  };
}

/** Projects one instant without ever wrapping values outside the fixed horizon. */
export function projectInstant(cycle: Cycle, at: UtcInstant): ProjectedInstant {
  const elapsedMs = instantMs(at, 'projected instant') - instantMs(cycle.startedAt, 'cycle start');
  const clampedElapsedMs = Math.min(CYCLE_HORIZON_MS, Math.max(0, elapsedMs));
  const overflow =
    elapsedMs < 0 ? 'before_start' : elapsedMs > CYCLE_HORIZON_MS ? 'after_horizon' : null;
  return {
    at,
    elapsedMs,
    clampedElapsedMs,
    angleDegrees:
      CYCLE_START_ANGLE_DEGREES + (clampedElapsedMs / CYCLE_HORIZON_MS) * CYCLE_SWEEP_ANGLE_DEGREES,
    overflow,
    overflowMs:
      elapsedMs < 0 ? -elapsedMs : elapsedMs > CYCLE_HORIZON_MS ? elapsedMs - CYCLE_HORIZON_MS : 0,
  };
}

/** Formats fixed real-time tick offsets in the cycle's retained IANA timezone. */
export function projectCycleTicks(
  cycle: Cycle,
  options: CycleTickOptions = {},
): readonly CycleTick[] {
  const offsets = options.offsetsMs ?? DEFAULT_TICK_OFFSETS_MS;
  const locale = options.locale ?? 'en-GB';
  assertTimezone(cycle.timezone);
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: cycle.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const startMs = instantMs(cycle.startedAt, 'cycle start');

  return offsets.map((offsetMs) => {
    if (!Number.isSafeInteger(offsetMs) || offsetMs < 0 || offsetMs > CYCLE_HORIZON_MS) {
      throw new Error(
        'Cycle tick offsets must be whole milliseconds within the fixed 24-hour horizon.',
      );
    }
    const at = new Date(startMs + offsetMs).toISOString();
    return {
      offsetMs,
      at,
      angleDegrees:
        CYCLE_START_ANGLE_DEGREES + (offsetMs / CYCLE_HORIZON_MS) * CYCLE_SWEEP_ANGLE_DEGREES,
      label: formatter.format(new Date(at)),
    };
  });
}

/** Assigns deterministic offsets within each lane while preserving every time angle. */
export function assignLaneCollisionOffsets(
  candidates: readonly CollisionCandidate[],
  options: CollisionOptions = {},
): readonly CollisionPlacement[] {
  const minimumAngleDegrees = options.minimumAngleDegrees ?? 8;
  const radialStep = options.radialStep ?? 8;
  const labelStep = options.labelStep ?? 12;
  if (!Number.isFinite(minimumAngleDegrees) || minimumAngleDegrees < 0) {
    throw new Error('The collision angle must be a non-negative number.');
  }
  if (
    !Number.isFinite(radialStep) ||
    radialStep < 0 ||
    !Number.isFinite(labelStep) ||
    labelStep < 0
  ) {
    throw new Error('Collision offset steps must be non-negative finite numbers.');
  }

  const byLane = new Map<string, CollisionCandidate[]>();
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.angleDegrees)) {
      throw new Error('A collision candidate requires a finite angle.');
    }
    const lane = byLane.get(candidate.lane);
    if (lane === undefined) byLane.set(candidate.lane, [candidate]);
    else lane.push(candidate);
  }

  const placements: CollisionPlacement[] = [];
  for (const lane of [...byLane.keys()].sort(compareCodeUnits)) {
    const sorted = [...(byLane.get(lane) ?? [])].sort(compareCollisionCandidates);
    let cluster: CollisionCandidate[] = [];
    const emitCluster = () => {
      for (const [clusterIndex, candidate] of cluster.entries()) {
        const offsetSteps = alternatingOffset(clusterIndex);
        placements.push({
          ...candidate,
          collision: {
            clusterIndex,
            clusterSize: cluster.length,
            offsetSteps,
            radialOffset: offsetSteps * radialStep,
            labelOffset: offsetSteps * labelStep,
          },
        });
      }
      cluster = [];
    };

    for (const candidate of sorted) {
      const previous = cluster.at(-1);
      if (
        previous !== undefined &&
        candidate.angleDegrees - previous.angleDegrees >= minimumAngleDegrees
      ) {
        emitCluster();
      }
      cluster.push(candidate);
    }
    emitCluster();
  }
  return placements;
}

function projectAnchors(cycle: Cycle): ProjectedCycleAnchor[] {
  const anchors: ProjectedCycleAnchor[] = [];
  if (cycle.startAnchor !== null) {
    anchors.push({
      ...cycle.startAnchor,
      boundary: 'start',
      projection: projectInstant(cycle, cycle.startAnchor.at),
    });
  }
  if (cycle.endAnchor !== null) {
    anchors.push({
      ...cycle.endAnchor,
      boundary: 'end',
      projection: projectInstant(cycle, cycle.endAnchor.at),
    });
  }
  return anchors;
}

function ownsStart(
  startedAtMs: number,
  cycleStartMs: number,
  canonicalEndMs: number | null,
  nowMs: number,
): boolean {
  if (startedAtMs < cycleStartMs) return false;
  if (canonicalEndMs !== null) return startedAtMs < canonicalEndMs;
  return startedAtMs <= nowMs;
}

function assertProjectableNight(session: SleepSession): asserts session is NightSleepSession {
  if (session.kind !== 'night') {
    throw new Error('Only a Night sleep session can anchor a cycle.');
  }
  assertValidSleepSession(session);
  if (session.deletedAt !== null) throw new Error('A deleted Night cannot anchor a cycle.');
  assertTimezone(session.timezone);
  instantMs(session.startedAt, 'Night Bedtime');
  if (session.endedAt !== null) instantMs(session.endedAt, 'Night Wake up');
  for (const phase of session.phases) {
    instantMs(phase.startedAt, 'Night phase start');
    if (phase.endedAt !== null) instantMs(phase.endedAt, 'Night phase end');
  }
}

function assertUniqueRecordIds(records: readonly CycleRecord[]): void {
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id)) {
      throw new Error('Cycle projection records require unique canonical IDs.');
    }
    ids.add(record.id);
  }
}

function compareProjectedRecords(left: ProjectedCycleRecord, right: ProjectedCycleRecord): number {
  const leftMs = left.token?.projection.elapsedMs ?? left.arc?.start.elapsedMs ?? 0;
  const rightMs = right.token?.projection.elapsedMs ?? right.arc?.start.elapsedMs ?? 0;
  return (
    leftMs - rightMs ||
    compareCodeUnits(left.lane, right.lane) ||
    compareCodeUnits(left.id, right.id)
  );
}

function compareCollisionCandidates(left: CollisionCandidate, right: CollisionCandidate): number {
  return left.angleDegrees - right.angleDegrees || compareCodeUnits(left.recordId, right.recordId);
}

function compareNightsByBedtime(left: NightSleepSession, right: NightSleepSession): number {
  return (
    instantMs(left.startedAt, 'Night Bedtime') - instantMs(right.startedAt, 'Night Bedtime') ||
    compareCodeUnits(left.id, right.id)
  );
}

function compareNightsByWakeUpDescending(
  left: CompletedNightSleepSession,
  right: CompletedNightSleepSession,
): number {
  return (
    instantMs(right.endedAt, 'Night Wake up') - instantMs(left.endedAt, 'Night Wake up') ||
    compareNightsByBedtime(right, left)
  );
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function alternatingOffset(index: number): number {
  if (index === 0) return 0;
  const magnitude = Math.ceil(index / 2);
  return index % 2 === 1 ? magnitude : -magnitude;
}

function collisionKey(candidate: CollisionCandidate): string {
  return `${candidate.lane}\u0000${candidate.recordId}\u0000${candidate.angleDegrees}`;
}

function instantMs(value: UtcInstant, label = 'instant'): number {
  const milliseconds = new Date(value).getTime();
  if (Number.isNaN(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`A valid canonical UTC ${label} is required.`);
  }
  return milliseconds;
}

function assertLocalDate(localDate: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (match === null) throw new Error('A local date must use YYYY-MM-DD.');
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('A valid local calendar date is required.');
  }
}

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0);
  } catch {
    throw new Error('A valid IANA timezone is required.');
  }
}

function shiftLocalDate(localDate: string, days: number): string {
  const [yearText, monthText, dayText] = localDate.split('-');
  const shifted = new Date(
    Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText) + days),
  );
  return [
    shifted.getUTCFullYear().toString().padStart(4, '0'),
    (shifted.getUTCMonth() + 1).toString().padStart(2, '0'),
    shifted.getUTCDate().toString().padStart(2, '0'),
  ].join('-');
}

function localMidnightUtc(localDate: string, timezone: string): UtcInstant {
  const [yearText, monthText, dayText] = localDate.split('-');
  const targetMs = Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText));
  let candidateMs = targetMs;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = localDateTimeParts(candidateMs, timezone);
    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const difference = targetMs - representedAsUtc;
    candidateMs += difference;
    if (difference === 0) break;
  }

  const resolved = localDateTimeParts(candidateMs, timezone);
  if (
    resolved.year !== Number(yearText) ||
    resolved.month !== Number(monthText) ||
    resolved.day !== Number(dayText) ||
    resolved.hour !== 0 ||
    resolved.minute !== 0 ||
    resolved.second !== 0
  ) {
    throw new Error('Local midnight does not exist in the requested timezone and date.');
  }
  return new Date(candidateMs).toISOString();
}

function localDateTimeParts(
  instant: number,
  timezone: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(instant))
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)]),
  );
  const { year, month, day, hour, minute, second } = parts;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    throw new Error('The requested timezone cannot resolve a local date.');
  }
  return { year, month, day, hour, minute, second };
}
