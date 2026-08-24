import {
  type MutationContext,
  type NursingSession,
  pauseNursing,
  resumeNursing,
  startNap,
  startNightSleep,
  startNightWaking,
  startNursing,
  stopNursing,
  switchNursingSide,
} from '@baby-tracker/domain';
import { describe, expect, it } from 'vitest';

import { deriveSleepHomeModel } from '../sleep/sleep-home-state';
import {
  appendNursingHomeAction,
  deriveNursingHomeModel,
  nursingGuidance,
} from './nursing-home-state';

describe('Nursing Home state', () => {
  it('keeps first-use Left and Right neutral without inventing Last or Next', () => {
    expect(nursingGuidance(null)).toEqual({ left: null, right: null });
    expect(deriveNursingHomeModel(null, null, new Date()).action).toMatchObject({
      meta: 'Start',
      active: false,
    });
  });

  it('derives Last and Next only from the latest completed explicit side', () => {
    expect(nursingGuidance('left')).toEqual({ left: 'Last', right: 'Next' });
    expect(nursingGuidance('right')).toEqual({ left: 'Next', right: 'Last' });

    const shortLast = completedNursingWithLastRight();
    expect(shortLast.leftDurationSeconds).toBeGreaterThan(shortLast.rightDurationSeconds);
    expect(deriveNursingHomeModel(null, shortLast.lastBreastUsed, new Date()).action.meta).toBe(
      'Next Left',
    );
  });

  it('projects persisted active and paused totals for the exact session', () => {
    const started = startNursing('left', context('2026-08-15T10:00:00.000Z')).session;
    const active = deriveNursingHomeModel(started, null, new Date('2026-08-15T10:01:05.900Z'));
    expect(active.controller).toMatchObject({
      sessionId: started.id,
      status: 'active',
      activeSide: 'left',
      leftDurationSeconds: 65,
      rightDurationSeconds: 0,
      totalDurationSeconds: 65,
    });

    const paused = pauseNursing(started, context('2026-08-15T10:01:00.000Z')).session;
    const pausedModel = deriveNursingHomeModel(paused, null, new Date('2026-08-15T10:01:30.000Z'));
    expect(pausedModel.action.meta).toBe('Paused');
    expect(pausedModel.controller).toMatchObject({
      sessionId: paused.id,
      status: 'paused',
      activeSide: null,
      leftDurationSeconds: 60,
      pauseDurationSeconds: 30,
      totalDurationSeconds: 60,
    });
  });

  it('clamps stale display clocks to every newly persisted open boundary', () => {
    const started = startNursing('left', context('2026-08-15T10:00:00.000Z')).session;
    expect(
      deriveNursingHomeModel(started, null, new Date('2026-08-15T09:59:30.000Z')).controller,
    ).toMatchObject({
      leftDurationSeconds: 0,
      rightDurationSeconds: 0,
      pauseDurationSeconds: 0,
      totalDurationSeconds: 0,
    });

    const switched = switchNursingSide(
      started,
      'right',
      context('2026-08-15T10:01:00.000Z'),
    ).session;
    expect(
      deriveNursingHomeModel(switched, null, new Date('2026-08-15T10:00:59.000Z')).controller,
    ).toMatchObject({
      leftDurationSeconds: 60,
      rightDurationSeconds: 0,
      pauseDurationSeconds: 0,
      totalDurationSeconds: 60,
    });

    const paused = pauseNursing(switched, context('2026-08-15T10:02:00.000Z')).session;
    expect(
      deriveNursingHomeModel(paused, null, new Date('2026-08-15T10:01:59.000Z')).controller,
    ).toMatchObject({
      leftDurationSeconds: 60,
      rightDurationSeconds: 60,
      pauseDurationSeconds: 0,
      totalDurationSeconds: 120,
    });

    const resumed = resumeNursing(paused, 'left', context('2026-08-15T10:03:00.000Z')).session;
    expect(
      deriveNursingHomeModel(resumed, null, new Date('2026-08-15T10:02:59.000Z')).controller,
    ).toMatchObject({
      leftDurationSeconds: 60,
      rightDurationSeconds: 60,
      pauseDurationSeconds: 60,
      totalDurationSeconds: 120,
    });
  });

  it.each(['awake', 'nap-active', 'night-asleep', 'night-awake'] as const)(
    'keeps Nursing in Home slot three while Sleep is %s',
    (sleepState) => {
      const sleep =
        sleepState === 'awake'
          ? null
          : sleepState === 'nap-active'
            ? startNap(context('2026-08-15T10:00:00.000Z')).session
            : sleepState === 'night-asleep'
              ? startNightSleep(context('2026-08-15T20:00:00.000Z')).session
              : startNightWaking(
                  startNightSleep(context('2026-08-15T20:00:00.000Z')).session,
                  context('2026-08-15T22:00:00.000Z'),
                ).session;
      const sleepModel = deriveSleepHomeModel(sleep, null);
      const nursingAction = deriveNursingHomeModel(null, null, new Date()).action;

      expect(sleepModel.state).toBe(sleepState);
      expect(
        appendNursingHomeAction(sleepModel.actions, nursingAction).map(({ kind }) => kind),
      ).toEqual([sleepModel.actions[0].kind, sleepModel.actions[1].kind, 'nursing']);
    },
  );
});

function completedNursingWithLastRight(): NursingSession {
  const started = startNursing('left', context('2026-08-15T10:00:00.000Z')).session;
  const switched = switchNursingSide(started, 'right', context('2026-08-15T10:01:40.000Z')).session;
  return stopNursing(switched, context('2026-08-15T10:01:50.000Z')).session;
}

function context(at: string): MutationContext {
  let sequence = 0;
  return {
    caregiverId: 'caregiver-paloma',
    childId: 'child-arthur',
    now: new Date(at),
    timezone: 'Europe/Lisbon',
    newId: () => `${at}-id-${sequence++}`,
  };
}
