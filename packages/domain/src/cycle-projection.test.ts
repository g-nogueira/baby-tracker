import { describe, expect, it } from 'vitest';

import {
  assignLaneCollisionOffsets,
  CYCLE_HORIZON_MS,
  createDayCycle,
  createEmptyNightCycle,
  createNightCycle,
  createUnanchoredDayCycle,
  projectCycle,
  projectCycleTicks,
  projectInstant,
  resolveCanonicalCycles,
} from './cycle-projection';
import type { CycleRecord, NapSession, NightSleepSession } from './index';

describe('cycle identities and anchors', () => {
  it('uses the Night session identity and its canonical Bedtime and Wake-up record ID', () => {
    const night = completedNight('night-1', '2026-08-12T20:30:00.000Z', '2026-08-13T06:15:00.000Z');

    const cycle = createNightCycle(night);

    expect(cycle).toMatchObject({
      id: 'night-1',
      identity: { kind: 'night', nightSessionId: 'night-1' },
      startedAt: '2026-08-12T20:30:00.000Z',
      endedAt: '2026-08-13T06:15:00.000Z',
      startAnchor: {
        kind: 'bedtime',
        recordId: 'night-1',
        at: '2026-08-12T20:30:00.000Z',
      },
      endAnchor: {
        kind: 'wake_up',
        recordId: 'night-1',
        at: '2026-08-13T06:15:00.000Z',
      },
    });
  });

  it('keys Day by the preceding Night and real Wake up, with the next Bedtime as context', () => {
    const preceding = completedNight(
      'night-1',
      '2026-08-12T20:30:00.000Z',
      '2026-08-13T06:15:00.000Z',
    );
    const next = activeNight('night-2', '2026-08-13T20:45:00.000Z');

    const cycle = createDayCycle(preceding, next);

    expect(cycle).toMatchObject({
      id: 'day:night-1:2026-08-13T06:15:00.000Z',
      identity: {
        kind: 'day',
        precedingNightSessionId: 'night-1',
        wakeUpAt: '2026-08-13T06:15:00.000Z',
      },
      startedAt: '2026-08-13T06:15:00.000Z',
      endedAt: '2026-08-13T20:45:00.000Z',
      startAnchor: { kind: 'wake_up', recordId: 'night-1' },
      endAnchor: { kind: 'bedtime', recordId: 'night-2' },
    });
    expect(createNightCycle(next).startAnchor).toEqual(cycle.endAnchor);
  });

  it('keeps an active Day identity stable without predicting Bedtime', () => {
    const preceding = completedNight(
      'night-1',
      '2026-08-12T20:30:00.000Z',
      '2026-08-13T06:15:00.000Z',
    );

    expect(createDayCycle(preceding)).toMatchObject({
      id: 'day:night-1:2026-08-13T06:15:00.000Z',
      endedAt: null,
      endAnchor: null,
    });
  });

  it('rejects fabricated or inconsistent Day boundaries', () => {
    const active = activeNight('night-active', '2026-08-13T06:15:00.000Z');
    expect(() => createDayCycle(active)).toThrow(
      'A Day cycle requires a completed preceding Night Wake up.',
    );

    const preceding = completedNight(
      'night-1',
      '2026-08-12T20:30:00.000Z',
      '2026-08-13T06:15:00.000Z',
    );
    expect(() =>
      createDayCycle(preceding, activeNight('night-2', '2026-08-13T06:14:00.000Z')),
    ).toThrow('The next Night Bedtime cannot precede the Day Wake up.');
  });

  it('represents missing Night explicitly without manufacturing an anchor', () => {
    expect(createEmptyNightCycle('2026-08-13', 'Europe/Lisbon')).toEqual({
      id: 'empty-night:Europe/Lisbon:2026-08-13',
      kind: 'empty_night',
      localDate: '2026-08-13',
      timezone: 'Europe/Lisbon',
      label: 'No night sleep logged',
    });
  });

  it('rejects a Nap or malformed real instant as a Night cycle anchor', () => {
    expect(() => createNightCycle(napSession() as unknown as NightSleepSession)).toThrow(
      'Only a Night sleep session can anchor a cycle.',
    );
    expect(() => createDayCycle(napSession() as unknown as NightSleepSession)).toThrow(
      'Only a Night sleep session can anchor a cycle.',
    );

    const malformed = activeNight('night-malformed', 'not-an-instant');
    expect(() => createNightCycle(malformed)).toThrow(
      'A valid canonical UTC Night Bedtime is required.',
    );
    expect(() =>
      createDayCycle(
        completedNight('night-valid', '2026-08-12T20:00:00.000Z', '2026-08-13T06:00:00.000Z'),
        malformed,
      ),
    ).toThrow('A valid canonical UTC Night Bedtime is required.');
  });
});

describe('canonical Night-history resolution', () => {
  it('selects the adjacent Night from unsorted history without skipping an intervening Bedtime', () => {
    const preceding = completedNight(
      'night-preceding',
      '2026-08-12T20:00:00.000Z',
      '2026-08-13T06:00:00.000Z',
    );
    const adjacent = completedNight(
      'night-adjacent',
      '2026-08-13T20:00:00.000Z',
      '2026-08-14T06:00:00.000Z',
    );
    const later = activeNight('night-later', '2026-08-14T20:00:00.000Z');
    const deletedSource = activeNight('night-deleted', '2026-08-13T19:00:00.000Z');
    const deleted: NightSleepSession = {
      ...deletedSource,
      deletedAt: '2026-08-13T19:30:00.000Z',
      phases: deletedSource.phases.map((phase) => ({
        ...phase,
        deletedAt: '2026-08-13T19:30:00.000Z',
      })),
    };
    const wrongChild = {
      ...activeNight('night-other-child', '2026-08-13T18:00:00.000Z'),
      childId: 'child-other',
    } satisfies NightSleepSession;

    const resolved = resolveCanonicalCycles(
      [later, napSession(), wrongChild, adjacent, deleted, preceding],
      { childId: 'child-arthur', localDate: '2026-08-13', timezone: 'Europe/Lisbon' },
    );

    expect(resolved.day).toMatchObject({
      kind: 'day',
      precedingNightSessionId: 'night-preceding',
      nextNightSessionId: 'night-adjacent',
    });
    expect(resolved.night).toMatchObject({ kind: 'night', sourceNightSessionId: 'night-adjacent' });
  });

  it('accepts an active adjacent Night as the real next Bedtime', () => {
    const preceding = completedNight(
      'night-preceding',
      '2026-08-12T20:00:00.000Z',
      '2026-08-13T06:00:00.000Z',
    );
    const active = activeNight('night-active', '2026-08-13T20:00:00.000Z');

    const resolved = resolveCanonicalCycles([active, preceding], {
      childId: 'child-arthur',
      localDate: '2026-08-13',
      timezone: 'Europe/Lisbon',
    });

    expect(resolved.day).toMatchObject({ kind: 'day', nextNightSessionId: 'night-active' });
    expect(resolved.night).toMatchObject({
      kind: 'night',
      sourceNightSessionId: 'night-active',
      endedAt: null,
    });
  });

  it('uses explicit Unanchored and empty states when there is no preceding Wake or Bedtime', () => {
    const noHistory = resolveCanonicalCycles([], {
      childId: 'child-arthur',
      localDate: '2026-08-13',
      timezone: 'Europe/Lisbon',
    });
    expect(noHistory.day).toMatchObject({ kind: 'unanchored_day', localDate: '2026-08-13' });
    expect(noHistory.night).toEqual(createEmptyNightCycle('2026-08-13', 'Europe/Lisbon'));

    const firstNight = activeNight('first-night', '2026-08-13T20:00:00.000Z');
    const withBedtimeOnly = resolveCanonicalCycles([firstNight], {
      childId: 'child-arthur',
      localDate: '2026-08-13',
      timezone: 'Europe/Lisbon',
    });
    expect(withBedtimeOnly.day.kind).toBe('unanchored_day');
    expect(withBedtimeOnly.night).toMatchObject({
      kind: 'night',
      sourceNightSessionId: 'first-night',
    });
  });

  it('ignores malformed Night instants outside the requested cycle boundaries', () => {
    const preceding = completedNight(
      'night-preceding',
      '2026-08-12T20:00:00.000Z',
      '2026-08-13T06:00:00.000Z',
    );
    const next = activeNight('night-next', '2026-08-13T20:00:00.000Z');
    const malformedBedtime = activeNight('malformed-bedtime', 'not-an-instant');
    const malformedWake = completedNight(
      'malformed-wake',
      '2026-08-01T20:00:00.000Z',
      'not-an-instant',
    );

    const resolved = resolveCanonicalCycles([malformedBedtime, malformedWake, next, preceding], {
      childId: 'child-arthur',
      localDate: '2026-08-13',
      timezone: 'Europe/Lisbon',
    });

    expect(resolved.day).toMatchObject({
      precedingNightSessionId: 'night-preceding',
      nextNightSessionId: 'night-next',
    });
    expect(resolved.night).toMatchObject({ sourceNightSessionId: 'night-next' });
  });
});

describe('unanchored legacy days', () => {
  it('uses real local midnights and never fabricates Wake-up anchors', () => {
    const cycle = createUnanchoredDayCycle('2026-08-13', 'Europe/Lisbon');

    expect(cycle).toEqual({
      id: 'unanchored-day:Europe/Lisbon:2026-08-13',
      identity: {
        kind: 'unanchored_day',
        localDate: '2026-08-13',
        timezone: 'Europe/Lisbon',
      },
      kind: 'unanchored_day',
      localDate: '2026-08-13',
      startedAt: '2026-08-12T23:00:00.000Z',
      endedAt: '2026-08-13T23:00:00.000Z',
      timezone: 'Europe/Lisbon',
      startAnchor: {
        kind: 'local_midnight',
        recordId: null,
        at: '2026-08-12T23:00:00.000Z',
        label: 'Unanchored day',
      },
      endAnchor: null,
    });
  });

  it('uses 23- and 25-real-hour local calendar bounds across Lisbon DST', () => {
    const spring = createUnanchoredDayCycle('2026-03-29', 'Europe/Lisbon');
    const fall = createUnanchoredDayCycle('2026-10-25', 'Europe/Lisbon');

    expect([spring.startedAt, spring.endedAt]).toEqual([
      '2026-03-29T00:00:00.000Z',
      '2026-03-29T23:00:00.000Z',
    ]);
    expect([fall.startedAt, fall.endedAt]).toEqual([
      '2026-10-24T23:00:00.000Z',
      '2026-10-26T00:00:00.000Z',
    ]);
  });

  it('uses the first representable instant when a timezone skips local midnight', () => {
    const cycle = createUnanchoredDayCycle('2026-09-06', 'America/Santiago');

    expect([cycle.startedAt, cycle.endedAt]).toEqual([
      '2026-09-06T04:00:00.000Z',
      '2026-09-07T03:00:00.000Z',
    ]);
  });

  it('keeps legacy records visible under local-day ownership and exposes fall-back overflow', () => {
    const summer = createUnanchoredDayCycle('2026-08-13', 'Europe/Lisbon');
    const summerProjection = projectCycle(
      summer,
      [
        {
          type: 'interval',
          id: 'legacy-nap',
          lane: 'outer',
          startedAt: '2026-08-13T11:00:00.000Z',
          endedAt: '2026-08-13T11:45:00.000Z',
        },
      ],
      { now: new Date('2026-08-14T12:00:00.000Z') },
    );
    const fallProjection = projectCycle(
      createUnanchoredDayCycle('2026-10-25', 'Europe/Lisbon'),
      [],
      { now: new Date('2026-10-26T12:00:00.000Z') },
    );

    expect(summerProjection.records).toMatchObject([
      { id: 'legacy-nap', ownership: 'primary', token: { recordId: 'legacy-nap' } },
    ]);
    expect(fallProjection.overflow).toMatchObject({
      hasOverflow: true,
      durationMs: 25 * 60 * 60 * 1_000,
      overflowMs: 60 * 60 * 1_000,
    });
  });
});

describe('fixed radial projection', () => {
  it('maps real elapsed time to the fixed 225° + 270° track without wrapping', () => {
    const cycle = createNightCycle(activeNight('night-1', '2026-08-12T20:00:00.000Z'));

    expect(projectInstant(cycle, '2026-08-12T20:00:00.000Z')).toMatchObject({
      elapsedMs: 0,
      angleDegrees: 225,
      overflow: null,
    });
    expect(projectInstant(cycle, '2026-08-13T02:00:00.000Z')).toMatchObject({
      elapsedMs: 6 * 60 * 60 * 1_000,
      angleDegrees: 292.5,
      overflow: null,
    });
    expect(projectInstant(cycle, '2026-08-13T08:00:00.000Z')).toMatchObject({
      angleDegrees: 360,
      overflow: null,
    });
    expect(projectInstant(cycle, '2026-08-13T20:00:00.000Z')).toMatchObject({
      angleDegrees: 495,
      overflow: null,
    });
    expect(projectInstant(cycle, '2026-08-13T22:00:00.000Z')).toMatchObject({
      elapsedMs: 26 * 60 * 60 * 1_000,
      clampedElapsedMs: CYCLE_HORIZON_MS,
      angleDegrees: 495,
      overflow: 'after_horizon',
      overflowMs: 2 * 60 * 60 * 1_000,
    });
    expect(projectInstant(cycle, '2026-08-12T19:30:00.000Z')).toMatchObject({
      angleDegrees: 225,
      overflow: 'before_start',
      overflowMs: 30 * 60 * 1_000,
    });
  });

  it('does not move existing tokens while an active cycle grows', () => {
    const cycle = createDayCycle(
      completedNight('night-1', '2026-08-12T21:00:00.000Z', '2026-08-13T06:00:00.000Z'),
    );
    const record: CycleRecord = {
      type: 'interval',
      id: 'nap-1',
      lane: 'outer',
      startedAt: '2026-08-13T09:00:00.000Z',
      endedAt: null,
    };

    const earlier = projectCycle(cycle, [record], {
      now: new Date('2026-08-13T10:00:00.000Z'),
    });
    const later = projectCycle(cycle, [record], {
      now: new Date('2026-08-13T18:00:00.000Z'),
    });

    expect(earlier.records[0]?.token?.projection.angleDegrees).toBe(
      later.records[0]?.token?.projection.angleDegrees,
    );
    expect(earlier.records[0]?.arc?.end.angleDegrees).toBeLessThan(
      later.records[0]?.arc?.end.angleDegrees ?? 0,
    );
    expect(earlier.overflow.horizonEndedAt).toBe(later.overflow.horizonEndedAt);
  });

  it('projects active intervals to now and excludes future starts from an open cycle', () => {
    const cycle = createNightCycle(activeNight('night-1', '2026-08-12T20:00:00.000Z'));
    const projection = projectCycle(
      cycle,
      [
        {
          type: 'interval',
          id: 'nursing-active',
          lane: 'inner',
          startedAt: '2026-08-12T21:00:00.000Z',
          endedAt: null,
        },
        {
          type: 'point',
          id: 'diaper-now',
          lane: 'point',
          occurredAt: '2026-08-12T22:00:00.000Z',
        },
        {
          type: 'point',
          id: 'future-medicine',
          lane: 'point',
          occurredAt: '2026-08-12T22:00:00.001Z',
        },
      ],
      { now: new Date('2026-08-12T22:00:00.000Z') },
    );

    expect(projection.observedEndedAt).toBe('2026-08-12T22:00:00.000Z');
    expect(projection.records.map(({ id }) => id)).toEqual(['nursing-active', 'diaper-now']);
    expect(projection.records[0]?.arc).toMatchObject({
      endedAt: '2026-08-12T22:00:00.000Z',
      active: true,
      actualDurationMs: 60 * 60 * 1_000,
    });
  });

  it('rejects active future starts and completed future ends in an open cycle', () => {
    const cycle = createNightCycle(activeNight('night-1', '2026-08-12T20:00:00.000Z'));
    const now = new Date('2026-08-12T22:00:00.000Z');

    expect(() =>
      projectCycle(
        cycle,
        [
          {
            type: 'interval',
            id: 'future-active',
            lane: 'inner',
            startedAt: '2026-08-12T22:00:00.001Z',
            endedAt: null,
          },
        ],
        { now },
      ),
    ).toThrow('An active projected interval cannot start after projection time.');
    expect(() =>
      projectCycle(
        cycle,
        [
          {
            type: 'interval',
            id: 'future-completed',
            lane: 'inner',
            startedAt: '2026-08-12T21:00:00.000Z',
            endedAt: '2026-08-12T22:00:00.001Z',
          },
        ],
        { now },
      ),
    ).toThrow('A completed projected interval cannot end after projection time.');
  });

  it('rejects duplicate canonical record identities before collision placement', () => {
    const cycle = createNightCycle(activeNight('night-1', '2026-08-12T20:00:00.000Z'));

    expect(() =>
      projectCycle(
        cycle,
        [
          {
            type: 'point',
            id: 'care-event-1',
            lane: 'point',
            occurredAt: '2026-08-12T21:00:00.000Z',
          },
          {
            type: 'point',
            id: 'care-event-1',
            lane: 'point',
            occurredAt: '2026-08-12T21:05:00.000Z',
          },
        ],
        { now: new Date('2026-08-12T22:00:00.000Z') },
      ),
    ).toThrow('Cycle projection records require unique canonical IDs.');
  });

  it('keeps over-24-hour cycles and records visible with explicit overflow metadata', () => {
    const cycle = createDayCycle(
      completedNight('night-1', '2026-08-11T21:00:00.000Z', '2026-08-12T06:00:00.000Z'),
      activeNight('night-2', '2026-08-13T08:00:00.000Z'),
    );
    const projection = projectCycle(
      cycle,
      [
        {
          type: 'point',
          id: 'late-diaper',
          lane: 'point',
          occurredAt: '2026-08-13T07:00:00.000Z',
        },
      ],
      { now: new Date('2026-08-14T00:00:00.000Z') },
    );

    expect(projection.overflow).toMatchObject({
      hasOverflow: true,
      durationMs: 26 * 60 * 60 * 1_000,
      overflowMs: 2 * 60 * 60 * 1_000,
      horizonEndedAt: '2026-08-13T06:00:00.000Z',
    });
    expect(projection.records[0]?.token?.projection).toMatchObject({
      angleDegrees: 495,
      overflow: 'after_horizon',
      overflowMs: 60 * 60 * 1_000,
    });
  });

  it('marks overflow only after the exact fixed 24-hour horizon', () => {
    const cycle = createNightCycle(activeNight('night-1', '2026-08-12T20:00:00.000Z'));

    expect(
      projectCycle(cycle, [], { now: new Date('2026-08-13T20:00:00.000Z') }).overflow,
    ).toMatchObject({ hasOverflow: false, overflowMs: 0 });
    expect(
      projectCycle(cycle, [], { now: new Date('2026-08-13T20:00:00.001Z') }).overflow,
    ).toMatchObject({ hasOverflow: true, overflowMs: 1 });
  });
});

describe('half-open ownership and continuations', () => {
  const priorNight = completedNight(
    'night-prior',
    '2026-08-12T20:00:00.000Z',
    '2026-08-13T06:00:00.000Z',
  );
  const nextNight = activeNight('night-next', '2026-08-13T20:00:00.000Z');
  const day = createDayCycle(priorNight, nextNight);
  const night = createNightCycle(nextNight);

  it('owns an exact end-boundary start only in the following cycle', () => {
    const boundaryRecords: CycleRecord[] = [
      {
        type: 'point',
        id: 'boundary-diaper',
        lane: 'point',
        occurredAt: '2026-08-13T20:00:00.000Z',
      },
    ];

    expect(
      projectCycle(day, boundaryRecords, { now: new Date('2026-08-13T21:00:00.000Z') }).records,
    ).toEqual([]);
    expect(
      projectCycle(night, boundaryRecords, { now: new Date('2026-08-13T21:00:00.000Z') }).records,
    ).toMatchObject([{ id: 'boundary-diaper', ownership: 'primary' }]);
  });

  it('renders a crossing interval as a clipped continuation without another start token', () => {
    const crossing: CycleRecord = {
      type: 'interval',
      id: 'nursing-crossing',
      lane: 'inner',
      startedAt: '2026-08-13T19:50:00.000Z',
      endedAt: '2026-08-13T20:10:00.000Z',
    };

    const dayRecord = projectCycle(day, [crossing], {
      now: new Date('2026-08-13T21:00:00.000Z'),
    }).records[0];
    const nightRecord = projectCycle(night, [crossing], {
      now: new Date('2026-08-13T21:00:00.000Z'),
    }).records[0];

    expect(dayRecord).toMatchObject({
      id: 'nursing-crossing',
      ownership: 'primary',
      arc: { clippedAtCycleEnd: true, endedAt: '2026-08-13T20:00:00.000Z' },
    });
    expect(dayRecord?.token?.recordId).toBe('nursing-crossing');
    expect(nightRecord).toMatchObject({
      id: 'nursing-crossing',
      ownership: 'continuation',
      token: null,
      arc: {
        clippedAtCycleStart: true,
        startedAt: '2026-08-13T20:00:00.000Z',
        start: { angleDegrees: 225 },
      },
    });
  });

  it('does not continue an interval that ends exactly at the cycle start', () => {
    const endingAtBoundary: CycleRecord = {
      type: 'interval',
      id: 'nursing-ended',
      lane: 'inner',
      startedAt: '2026-08-13T19:50:00.000Z',
      endedAt: '2026-08-13T20:00:00.000Z',
    };

    expect(
      projectCycle(night, [endingAtBoundary], {
        now: new Date('2026-08-13T21:00:00.000Z'),
      }).records,
    ).toEqual([]);
  });

  it('projects the neighboring Bedtime anchors with one canonical source ID', () => {
    const dayEnd = projectCycle(day, [], {
      now: new Date('2026-08-13T21:00:00.000Z'),
    }).anchors.at(-1);
    const nightStart = projectCycle(night, [], {
      now: new Date('2026-08-13T21:00:00.000Z'),
    }).anchors[0];

    expect(dayEnd).toMatchObject({
      kind: 'bedtime',
      recordId: 'night-next',
      boundary: 'end',
    });
    expect(nightStart).toMatchObject({
      kind: 'bedtime',
      recordId: 'night-next',
      boundary: 'start',
    });
  });

  it('projects the neighboring Wake-up anchors with one canonical source ID', () => {
    const priorNightProjection = projectCycle(createNightCycle(priorNight), [], {
      now: new Date('2026-08-13T21:00:00.000Z'),
    });
    const dayProjection = projectCycle(day, [], {
      now: new Date('2026-08-13T21:00:00.000Z'),
    });

    expect(priorNightProjection.anchors.at(-1)).toMatchObject({
      kind: 'wake_up',
      recordId: 'night-prior',
      boundary: 'end',
    });
    expect(dayProjection.anchors[0]).toMatchObject({
      kind: 'wake_up',
      recordId: 'night-prior',
      boundary: 'start',
    });
  });
});

describe('timezone-aware fixed ticks', () => {
  it('formats spring-forward ticks from real UTC offsets in Europe/Lisbon', () => {
    const cycle = createNightCycle(activeNight('spring', '2026-03-29T00:30:00.000Z'));
    const ticks = projectCycleTicks(cycle, {
      offsetsMs: [0, 60 * 60 * 1_000, 2 * 60 * 60 * 1_000, 3 * 60 * 60 * 1_000],
      locale: 'en-GB',
    });

    expect(ticks.map(({ at, label }) => [at, label])).toEqual([
      ['2026-03-29T00:30:00.000Z', '00:30'],
      ['2026-03-29T01:30:00.000Z', '02:30'],
      ['2026-03-29T02:30:00.000Z', '03:30'],
      ['2026-03-29T03:30:00.000Z', '04:30'],
    ]);
  });

  it('formats both repeated fall-back clock labels from distinct real instants', () => {
    const cycle = createNightCycle(activeNight('fall', '2026-10-25T00:30:00.000Z'));
    const ticks = projectCycleTicks(cycle, {
      offsetsMs: [0, 60 * 60 * 1_000, 2 * 60 * 60 * 1_000, 3 * 60 * 60 * 1_000],
      locale: 'en-GB',
    });

    expect(ticks.map(({ at, label }) => [at, label])).toEqual([
      ['2026-10-25T00:30:00.000Z', '01:30'],
      ['2026-10-25T01:30:00.000Z', '01:30'],
      ['2026-10-25T02:30:00.000Z', '02:30'],
      ['2026-10-25T03:30:00.000Z', '03:30'],
    ]);
    expect(ticks.map(({ angleDegrees }) => angleDegrees)).toEqual([225, 236.25, 247.5, 258.75]);
  });
});

describe('lane-local collision offsets', () => {
  it('is independent of input order and never changes a token time angle', () => {
    const candidates = [
      { recordId: 'c', lane: 'inner', angleDegrees: 104 },
      { recordId: 'solo', lane: 'point', angleDegrees: 102 },
      { recordId: 'a', lane: 'inner', angleDegrees: 100 },
      { recordId: 'b', lane: 'inner', angleDegrees: 102 },
      { recordId: 'later', lane: 'inner', angleDegrees: 120 },
    ];

    const forward = assignLaneCollisionOffsets(candidates, {
      minimumAngleDegrees: 8,
      radialStep: 6,
      labelStep: 10,
    });
    const reversed = assignLaneCollisionOffsets([...candidates].reverse(), {
      minimumAngleDegrees: 8,
      radialStep: 6,
      labelStep: 10,
    });

    expect(reversed).toEqual(forward);
    expect(forward).toEqual([
      {
        recordId: 'a',
        lane: 'inner',
        angleDegrees: 100,
        collision: {
          clusterIndex: 0,
          clusterSize: 3,
          offsetSteps: 0,
          radialOffset: 0,
          labelOffset: 0,
        },
      },
      {
        recordId: 'b',
        lane: 'inner',
        angleDegrees: 102,
        collision: {
          clusterIndex: 1,
          clusterSize: 3,
          offsetSteps: 1,
          radialOffset: 6,
          labelOffset: 10,
        },
      },
      {
        recordId: 'c',
        lane: 'inner',
        angleDegrees: 104,
        collision: {
          clusterIndex: 2,
          clusterSize: 3,
          offsetSteps: -1,
          radialOffset: -6,
          labelOffset: -10,
        },
      },
      {
        recordId: 'later',
        lane: 'inner',
        angleDegrees: 120,
        collision: {
          clusterIndex: 0,
          clusterSize: 1,
          offsetSteps: 0,
          radialOffset: 0,
          labelOffset: 0,
        },
      },
      {
        recordId: 'solo',
        lane: 'point',
        angleDegrees: 102,
        collision: {
          clusterIndex: 0,
          clusterSize: 1,
          offsetSteps: 0,
          radialOffset: 0,
          labelOffset: 0,
        },
      },
    ]);
  });

  it('uses code-unit tie-breaking for non-ASCII IDs regardless of input order', () => {
    const candidates = [
      { recordId: 'ä', lane: 'inner', angleDegrees: 100 },
      { recordId: 'z', lane: 'inner', angleDegrees: 100 },
    ];

    const forward = assignLaneCollisionOffsets(candidates);
    const reversed = assignLaneCollisionOffsets([...candidates].reverse());

    expect(reversed).toEqual(forward);
    expect(forward.map(({ recordId }) => recordId)).toEqual(['z', 'ä']);
  });

  it('rejects negative collision offset steps', () => {
    expect(() => assignLaneCollisionOffsets([], { radialStep: -1 })).toThrow(
      'Collision offset steps must be non-negative finite numbers.',
    );
    expect(() => assignLaneCollisionOffsets([], { labelStep: -1 })).toThrow(
      'Collision offset steps must be non-negative finite numbers.',
    );
  });
});

describe('projection input validation', () => {
  it('requires whole safe-millisecond tick offsets', () => {
    const cycle = createNightCycle(activeNight('night-1', '2026-08-12T20:00:00.000Z'));

    expect(() => projectCycleTicks(cycle, { offsetsMs: [0.5] })).toThrow(
      'Cycle tick offsets must be whole milliseconds within the fixed 24-hour horizon.',
    );
  });
});

function activeNight(id: string, startedAt: string): NightSleepSession {
  return nightSession(id, startedAt, null);
}

function completedNight(id: string, startedAt: string, endedAt: string): NightSleepSession {
  return nightSession(id, startedAt, endedAt);
}

function nightSession(id: string, startedAt: string, endedAt: string | null): NightSleepSession {
  return {
    id,
    childId: 'child-arthur',
    kind: 'night',
    startedAt,
    endedAt,
    status: endedAt === null ? 'active' : 'completed',
    timezone: 'Europe/Lisbon',
    createdBy: 'caregiver-paloma',
    updatedBy: 'caregiver-paloma',
    version: endedAt === null ? 1 : 2,
    deletedAt: null,
    phases: [
      {
        id: `${id}-phase`,
        sleepSessionId: id,
        kind: 'asleep',
        startedAt,
        endedAt,
        createdBy: 'caregiver-paloma',
        updatedBy: 'caregiver-paloma',
        version: endedAt === null ? 1 : 2,
        deletedAt: null,
      },
    ],
  };
}

function napSession(): NapSession {
  return {
    id: 'nap-1',
    childId: 'child-arthur',
    kind: 'nap',
    startedAt: '2026-08-13T10:00:00.000Z',
    endedAt: '2026-08-13T10:30:00.000Z',
    status: 'completed',
    timezone: 'Europe/Lisbon',
    createdBy: 'caregiver-paloma',
    updatedBy: 'caregiver-paloma',
    version: 2,
    deletedAt: null,
    phases: [
      {
        id: 'nap-1-phase',
        sleepSessionId: 'nap-1',
        kind: 'asleep',
        startedAt: '2026-08-13T10:00:00.000Z',
        endedAt: '2026-08-13T10:30:00.000Z',
        createdBy: 'caregiver-paloma',
        updatedBy: 'caregiver-paloma',
        version: 2,
        deletedAt: null,
      },
    ],
  };
}
