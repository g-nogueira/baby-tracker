import type {
  CareEvent,
  NightSleepSession,
  NursingSession,
  SleepSession,
} from '@baby-tracker/domain';
import { describe, expect, it } from 'vitest';

import { buildRadialCycleViews, clusterRadialTargets } from './radial-cycle-state';

const childId = 'child-1';
const timezone = 'Europe/Lisbon';
const now = new Date('2026-08-16T12:00:00.000Z');

describe('radial cycle state', () => {
  it('separates Day and Night ownership while preserving stable editor IDs', () => {
    const previous = night(
      'night-previous',
      '2026-08-14T20:00:00.000Z',
      '2026-08-15T06:00:00.000Z',
    );
    const next = night('night-next', '2026-08-15T20:00:00.000Z', '2026-08-16T06:00:00.000Z');
    const nap = sleep('nap-1', 'nap', '2026-08-15T10:00:00.000Z', '2026-08-15T11:00:00.000Z');
    const nursing = nursingSession(
      'nursing-1',
      '2026-08-15T20:30:00.000Z',
      '2026-08-15T21:00:00.000Z',
    );
    const medicine = careEvent('medicine-1', 'medicine', '2026-08-15T12:00:00.000Z');

    const views = buildRadialCycleViews({
      careEvents: [medicine],
      childId,
      localDate: '2026-08-15',
      now,
      nursingSessions: [nursing],
      sleepSessions: [previous, nap, next],
      timezone,
    });

    expect(views.day.records.map(({ id, kind }) => [id, kind])).toEqual([
      ['nap-1', 'nap'],
      ['medicine-1', 'medicine'],
    ]);
    expect(
      views.night.records.map(({ id, kind, editorRecordId }) => [id, kind, editorRecordId]),
    ).toEqual([
      ['night-next', 'night', 'night-next'],
      ['nursing-1', 'nursing', 'nursing-1'],
    ]);
  });

  it('keeps Today on the same active Night after midnight without changing dated history', () => {
    const active = night('night-active', '2026-08-15T20:00:00.000Z', null);
    const input = {
      careEvents: [],
      childId,
      localDate: '2026-08-16',
      now: new Date('2026-08-16T02:00:00Z'),
      nursingSessions: [],
      sleepSessions: [active],
      timezone,
    };
    const today = buildRadialCycleViews({ ...input, showActiveNight: true }).night;
    expect(today.projection?.cycle.id).toBe(active.id);
    expect(today.records[0]?.projection.arc?.actualDurationMs).toBe(6 * 60 * 60 * 1000);
    expect(buildRadialCycleViews(input).night.projection).toBeNull();
    expect(
      buildRadialCycleViews({ ...input, localDate: '2026-08-15' }).night.projection?.cycle.id,
    ).toBe(active.id);
  });

  it('projects Night waking in the inner lane and point events without fake arcs', () => {
    const session = night('night-1', '2026-08-15T20:00:00.000Z', '2026-08-16T06:00:00.000Z', true);
    const diaper = careEvent('diaper-1', 'diaper', '2026-08-15T23:00:00.000Z');
    const view = buildRadialCycleViews({
      careEvents: [diaper],
      childId,
      localDate: '2026-08-15',
      now,
      nursingSessions: [],
      sleepSessions: [session],
      timezone,
    }).night;

    const waking = view.records.find(({ kind }) => kind === 'night-waking');
    const point = view.records.find(({ kind }) => kind === 'diaper');
    expect(waking).toMatchObject({ editorRecordId: 'night-1', projection: { lane: 'inner' } });
    expect(point?.projection.arc).toBeNull();
    expect(point?.projection.token?.recordId).toBe('diaper-1');
  });

  it('keeps a cross-boundary interval as a selectable continuation without a duplicate token', () => {
    const previous = night(
      'night-previous',
      '2026-08-14T20:00:00.000Z',
      '2026-08-15T06:00:00.000Z',
    );
    const nursing = nursingSession(
      'nursing-1',
      '2026-08-15T05:50:00.000Z',
      '2026-08-15T06:10:00.000Z',
    );
    const day = buildRadialCycleViews({
      careEvents: [],
      childId,
      localDate: '2026-08-15',
      now,
      nursingSessions: [nursing],
      sleepSessions: [previous],
      timezone,
    }).day;
    const continuation = day.records.find(({ id }) => id === 'nursing-1');
    expect(continuation?.projection).toMatchObject({ ownership: 'continuation', token: null });
    expect(continuation?.projection.arc?.clippedAtCycleStart).toBe(true);
  });

  it('keeps clustered point angles truthful while assigning distinct radial offsets', () => {
    const previous = night(
      'night-previous',
      '2026-08-14T20:00:00.000Z',
      '2026-08-15T06:00:00.000Z',
    );
    const occurredAt = '2026-08-15T12:00:00.000Z';
    const day = buildRadialCycleViews({
      careEvents: [
        careEvent('diaper-1', 'diaper', occurredAt),
        careEvent('medicine-1', 'medicine', occurredAt),
      ],
      childId,
      localDate: '2026-08-15',
      now,
      nursingSessions: [],
      sleepSessions: [previous],
      timezone,
    }).day;
    const points = day.records.filter(({ kind }) => kind === 'diaper' || kind === 'medicine');
    expect(points.map(({ projection }) => projection.token?.projection.angleDegrees)).toEqual([
      292.5, 292.5,
    ]);
    expect(points.map(({ projection }) => projection.token?.collision.radialOffset)).toEqual([
      0, 8,
    ]);
  });
});

function sleep(id: string, kind: 'nap', startedAt: string, endedAt: string): SleepSession {
  return {
    id,
    childId,
    kind,
    startedAt,
    endedAt,
    status: 'completed',
    timezone,
    createdBy: 'caregiver',
    updatedBy: 'caregiver',
    version: 1,
    deletedAt: null,
    phases: [
      {
        id: `${id}-phase`,
        sleepSessionId: id,
        kind: 'asleep',
        startedAt,
        endedAt,
        createdBy: 'caregiver',
        updatedBy: 'caregiver',
        version: 1,
        deletedAt: null,
      },
    ],
  };
}

function night(
  id: string,
  startedAt: string,
  endedAt: string | null,
  waking = false,
): NightSleepSession {
  const boundary = '2026-08-15T22:00:00.000Z';
  return {
    id,
    childId,
    kind: 'night',
    startedAt,
    endedAt,
    status: endedAt === null ? 'active' : 'completed',
    timezone,
    createdBy: 'caregiver',
    updatedBy: 'caregiver',
    version: 1,
    deletedAt: null,
    phases: waking
      ? [
          {
            id: `${id}-asleep`,
            sleepSessionId: id,
            kind: 'asleep',
            startedAt,
            endedAt: boundary,
            createdBy: 'caregiver',
            updatedBy: 'caregiver',
            version: 1,
            deletedAt: null,
          },
          {
            id: `${id}-awake`,
            sleepSessionId: id,
            kind: 'awake',
            startedAt: boundary,
            endedAt,
            createdBy: 'caregiver',
            updatedBy: 'caregiver',
            version: 1,
            deletedAt: null,
          },
        ]
      : [
          {
            id: `${id}-asleep`,
            sleepSessionId: id,
            kind: 'asleep',
            startedAt,
            endedAt,
            createdBy: 'caregiver',
            updatedBy: 'caregiver',
            version: 1,
            deletedAt: null,
          },
        ],
  };
}

function nursingSession(id: string, startedAt: string, endedAt: string): NursingSession {
  return {
    id,
    childId,
    startedAt,
    endedAt,
    status: 'completed',
    leftDurationSeconds: 600,
    rightDurationSeconds: 900,
    totalPauseDurationSeconds: 300,
    activeSide: null,
    activeSideStartedAt: null,
    pauseStartedAt: null,
    lastBreastUsed: 'right',
    timezone,
    createdBy: 'caregiver',
    updatedBy: 'caregiver',
    version: 1,
    deletedAt: null,
  };
}

function careEvent(id: string, kind: 'diaper' | 'medicine', occurredAt: string): CareEvent {
  const common = {
    id,
    childId,
    occurredAt,
    timezone,
    createdBy: 'caregiver',
    updatedBy: 'caregiver',
    version: 1,
    deletedAt: null,
  };
  return kind === 'diaper'
    ? { ...common, kind, data: { diaperType: 'wet' } }
    : { ...common, kind, data: { note: 'private' } };
}

it('fits a completed Night to its real duration and places a timezone-aware midnight marker', () => {
  const session = night('fit-night', '2026-08-15T20:00:00.000Z', '2026-08-16T06:00:00.000Z');
  const view = buildRadialCycleViews({
    careEvents: [],
    childId,
    localDate: '2026-08-15',
    now,
    nursingSessions: [],
    sleepSessions: [session],
    timezone,
  }).night;
  expect(
    view.projection?.anchors.find((anchor) => anchor.kind === 'wake_up')?.projection.angleDegrees,
  ).toBe(495);
  const midnight = view.ticks.find((tick) => tick.label === 'Midnight');
  expect(midnight?.at).toBe('2026-08-15T23:00:00.000Z');
  expect(midnight?.angleDegrees).toBe(306);
});
it('keeps active Night marker scale stable between second ticks and expands at bounded steps', () => {
  const session = night('active-fit-night', '2026-08-15T20:00:00.000Z', null);
  const input = {
    careEvents: [careEvent('point', 'diaper', '2026-08-15T21:00:00.000Z')],
    childId,
    localDate: '2026-08-15',
    nursingSessions: [],
    sleepSessions: [session],
    timezone,
  };
  const first = buildRadialCycleViews({ ...input, now: new Date('2026-08-16T06:00:00Z') }).night;
  const second = buildRadialCycleViews({ ...input, now: new Date('2026-08-16T06:00:01Z') }).night;
  expect(
    first.records.find((record) => record.id === 'point')?.projection.token?.projection
      .angleDegrees,
  ).toBe(
    second.records.find((record) => record.id === 'point')?.projection.token?.projection
      .angleDegrees,
  );
  expect(first.projection?.anchors.some((anchor) => anchor.kind === 'wake_up')).toBe(false);
});
it('retains every crowded record ID in bounded groups across activity types', () => {
  const events = Array.from({ length: 30 }, (_, index) =>
    careEvent(
      `event-${index}`,
      index % 2 ? 'medicine' : 'diaper',
      new Date(Date.parse('2026-08-15T10:00:00Z') + index * 60000).toISOString(),
    ),
  );
  const view = buildRadialCycleViews({
    careEvents: events,
    childId,
    localDate: '2026-08-15',
    now,
    nursingSessions: [],
    sleepSessions: [],
    timezone,
  }).day;
  const groups = clusterRadialTargets(view.records, 24);
  expect(groups.length).toBe(1);
  expect(groups[0].map((record) => record.id).sort()).toEqual(
    events.map((event) => event.id).sort(),
  );
  expect(clusterRadialTargets(view.records, 1).length).toBeGreaterThan(1);
});
