import {
  type CareEvent,
  type CycleProjection,
  type CycleRecord,
  type CycleTick,
  createNightCycle,
  type DiaperType,
  type NursingSession,
  type NursingStatus,
  projectCycle,
  projectCycleTicks,
  resolveCanonicalCycles,
  type SleepSession,
} from '@baby-tracker/domain';

export type RadialActivityKind =
  | 'diaper'
  | 'medicine'
  | 'nap'
  | 'night'
  | 'night-waking'
  | 'nursing';

export interface RadialActivityRecord {
  editorRecordId: string;
  endedAt: string | null;
  id: string;
  kind: RadialActivityKind;
  medicineNote?: string;
  occurredAt: string;
  status: 'active' | 'completed' | NursingStatus;
  diaperType: DiaperType | null;
}

export interface ProjectedRadialActivity extends RadialActivityRecord {
  projection: CycleProjection['records'][number];
}

export interface RadialCycleView {
  kind: 'day' | 'night';
  emptyLabel: string | null;
  projection: CycleProjection | null;
  records: readonly ProjectedRadialActivity[];
  ticks: readonly CycleTick[];
}

export interface RadialCycleViews {
  day: RadialCycleView;
  night: RadialCycleView;
}

interface BuildRadialCycleViewsInput {
  /** Today follows the containing Night through midnight; dated history keeps its own cycle. */
  showActiveNight?: boolean;
  careEvents: readonly CareEvent[];
  childId: string;
  localDate: string;
  now: Date;
  nursingSessions: readonly NursingSession[];
  sleepSessions: readonly SleepSession[];
  timezone: string;
}

const TICK_OFFSETS_MS = [0, 6, 12, 18, 24].map((hours) => hours * 60 * 60 * 1_000);

/** Adapts canonical aggregates to both fixed cycle projections without UI dependencies. */
export function buildRadialCycleViews(input: BuildRadialCycleViewsInput): RadialCycleViews {
  const cycles = resolveCanonicalCycles(input.sleepSessions, {
    childId: input.childId,
    localDate: input.localDate,
    timezone: input.timezone,
  });
  const activeNight = input.showActiveNight
    ? input.sleepSessions.find(
        (session) =>
          session.kind === 'night' &&
          session.childId === input.childId &&
          session.status === 'active' &&
          session.deletedAt === null,
      )
    : undefined;
  const nightCycle = activeNight?.kind === 'night' ? createNightCycle(activeNight) : cycles.night;
  const { records, metadata } = radialRecords(input);
  const dayProjection = projectCycle(cycles.day, records, { now: input.now });

  return {
    day: projectedView('day', dayProjection, metadata),
    night:
      nightCycle.kind === 'empty_night'
        ? {
            kind: 'night',
            emptyLabel: nightCycle.label,
            projection: null,
            records: [],
            ticks: [],
          }
        : projectedView('night', projectCycle(nightCycle, records, { now: input.now }), metadata),
  };
}

function projectedView(
  kind: RadialCycleView['kind'],
  projection: CycleProjection,
  metadata: ReadonlyMap<string, RadialActivityRecord>,
): RadialCycleView {
  return {
    kind,
    emptyLabel: null,
    projection,
    records: projection.records.map((record) => {
      const activity = metadata.get(record.id);
      if (activity === undefined)
        throw new Error('Every projected record requires activity metadata.');
      return { ...activity, projection: record };
    }),
    ticks: projectCycleTicks(projection.cycle, { offsetsMs: TICK_OFFSETS_MS }),
  };
}

function radialRecords(input: BuildRadialCycleViewsInput): {
  records: CycleRecord[];
  metadata: Map<string, RadialActivityRecord>;
} {
  const records: CycleRecord[] = [];
  const metadata = new Map<string, RadialActivityRecord>();
  const add = (record: CycleRecord, activity: RadialActivityRecord) => {
    if (metadata.has(record.id)) throw new Error('Radial records require globally unique IDs.');
    records.push(record);
    metadata.set(record.id, activity);
  };

  for (const session of input.sleepSessions) {
    add(
      {
        type: 'interval',
        id: session.id,
        lane: 'outer',
        startedAt: session.startedAt,
        endedAt: session.endedAt,
      },
      {
        id: session.id,
        editorRecordId: session.id,
        kind: session.kind,
        occurredAt: session.startedAt,
        endedAt: session.endedAt,
        status: session.status,
        diaperType: null,
      },
    );
    if (session.kind !== 'night') continue;
    for (const phase of session.phases) {
      if (phase.kind !== 'awake' || phase.deletedAt !== null) continue;
      add(
        {
          type: 'interval',
          id: phase.id,
          lane: 'inner',
          startedAt: phase.startedAt,
          endedAt: phase.endedAt,
        },
        {
          id: phase.id,
          editorRecordId: session.id,
          kind: 'night-waking',
          occurredAt: phase.startedAt,
          endedAt: phase.endedAt,
          status: phase.endedAt === null ? 'active' : 'completed',
          diaperType: null,
        },
      );
    }
  }

  for (const session of input.nursingSessions) {
    if (session.deletedAt !== null) continue;
    add(
      {
        type: 'interval',
        id: session.id,
        lane: 'inner',
        startedAt: session.startedAt,
        endedAt: session.endedAt,
      },
      {
        id: session.id,
        editorRecordId: session.id,
        kind: 'nursing',
        occurredAt: session.startedAt,
        endedAt: session.endedAt,
        status: session.status,
        diaperType: null,
      },
    );
  }

  for (const event of input.careEvents) {
    if (event.deletedAt !== null) continue;
    add(
      { type: 'point', id: event.id, lane: 'point', occurredAt: event.occurredAt },
      {
        id: event.id,
        editorRecordId: event.id,
        kind: event.kind,
        ...(event.kind === 'medicine' ? { medicineNote: event.data.note } : {}),
        occurredAt: event.occurredAt,
        endedAt: null,
        status: 'completed',
        diaperType: event.kind === 'diaper' ? event.data.diaperType : null,
      },
    );
  }

  return { records, metadata };
}
