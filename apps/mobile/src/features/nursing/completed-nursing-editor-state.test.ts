import type { NursingSession } from '@baby-tracker/domain';
import { describe, expect, it } from 'vitest';

import {
  completedNursingCorrectionForSave,
  completedNursingEditorError,
  completedNursingEditorTotals,
  createCompletedNursingEditorState,
  updateCompletedNursingBoundary,
  updateCompletedNursingLeftSeconds,
} from './completed-nursing-editor-state';

describe('completed Nursing editor state', () => {
  const now = new Date('2026-08-16T01:00:00.000Z');

  it('derives Right from the one editable Left value at every slider position', () => {
    const initial = createCompletedNursingEditorState(session());
    for (let leftDurationSeconds = 0; leftDurationSeconds <= 90; leftDurationSeconds += 1) {
      const edited = updateCompletedNursingLeftSeconds(initial, leftDurationSeconds);
      const totals = completedNursingEditorTotals(edited);
      expect(totals.rightDurationSeconds).toBe(90 - leftDurationSeconds);
      expect(
        leftDurationSeconds +
          (totals.rightDurationSeconds ?? Number.NaN) +
          totals.pauseDurationSeconds,
      ).toBe(totals.elapsedDurationSeconds);
    }
  });

  it('preserves ratio to nearest second across odd, short, and cross-midnight bounds', () => {
    for (const [left, right] of [
      [1, 2],
      [2, 1],
      [1, 1],
      [0, 3],
      [3, 0],
      [0, 0],
    ] as const) {
      const sourceStart = new Date('2026-08-15T23:59:00.000Z');
      const source = session({
        endedAt: new Date(sourceStart.getTime() + (left + right + 30) * 1_000).toISOString(),
        leftDurationSeconds: left,
        rightDurationSeconds: right,
      });
      const initial = createCompletedNursingEditorState(source);
      const resized = updateCompletedNursingBoundary(
        updateCompletedNursingBoundary(initial, 'startedAt', new Date('2026-08-15T23:59:30.000Z')),
        'endedAt',
        new Date('2026-08-16T00:00:37.000Z'),
      );
      const activeDurationSeconds = 37;
      const expectedLeft =
        left + right === 0
          ? source.lastBreastUsed === 'left'
            ? activeDurationSeconds
            : 0
          : Math.round(activeDurationSeconds * (left / (left + right)));
      expect(completedNursingEditorTotals(resized)).toMatchObject({
        elapsedDurationSeconds: 67,
        activeDurationSeconds,
        leftDurationSeconds: expectedLeft,
        rightDurationSeconds: activeDurationSeconds - expectedLeft,
        pauseDurationSeconds: 30,
      });
      if (left + right > 0) {
        expect(
          Math.abs(resized.leftDurationSeconds - activeDurationSeconds * (left / (left + right))),
        ).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('preserves the invariant and nearest-second ratio over broad deterministic cases', () => {
    const baseStartedAt = new Date('2026-08-15T12:00:00.000Z');
    for (let sourceActiveSeconds = 0; sourceActiveSeconds <= 24; sourceActiveSeconds += 1) {
      for (
        let sourceLeftSeconds = 0;
        sourceLeftSeconds <= sourceActiveSeconds;
        sourceLeftSeconds += 1
      ) {
        for (const pauseDurationSeconds of [0, 1, 7]) {
          const source = session({
            startedAt: baseStartedAt.toISOString(),
            endedAt: new Date(
              baseStartedAt.getTime() + (sourceActiveSeconds + pauseDurationSeconds) * 1_000,
            ).toISOString(),
            leftDurationSeconds: sourceLeftSeconds,
            rightDurationSeconds: sourceActiveSeconds - sourceLeftSeconds,
            totalPauseDurationSeconds: pauseDurationSeconds,
            lastBreastUsed:
              sourceActiveSeconds > 0 && sourceLeftSeconds === sourceActiveSeconds
                ? 'left'
                : 'right',
          });
          const initial = createCompletedNursingEditorState(source);
          for (const targetActiveSeconds of [0, 1, 2, 3, 11, 37]) {
            const resized = updateCompletedNursingBoundary(
              initial,
              'endedAt',
              new Date(
                baseStartedAt.getTime() + (targetActiveSeconds + pauseDurationSeconds) * 1_000,
              ),
            );
            const totals = completedNursingEditorTotals(resized);
            expect(totals).toMatchObject({
              elapsedDurationSeconds: targetActiveSeconds + pauseDurationSeconds,
              activeDurationSeconds: targetActiveSeconds,
              pauseDurationSeconds,
            });
            expect(
              resized.leftDurationSeconds +
                (totals.rightDurationSeconds ?? Number.NaN) +
                pauseDurationSeconds,
            ).toBe(targetActiveSeconds + pauseDurationSeconds);
            if (sourceActiveSeconds > 0) {
              const exactLeft = targetActiveSeconds * (sourceLeftSeconds / sourceActiveSeconds);
              expect(Math.abs(resized.leftDurationSeconds - exactLeft)).toBeLessThanOrEqual(0.5);
            }
          }
        }
      }
    }
  });

  it('handles zero active time, one-second allocation, and a nearest-second tie', () => {
    const zero = createCompletedNursingEditorState(
      session({
        endedAt: '2026-08-15T23:59:30.000Z',
        leftDurationSeconds: 0,
        rightDurationSeconds: 0,
        lastBreastUsed: 'right',
      }),
    );
    expect(completedNursingEditorTotals(updateCompletedNursingLeftSeconds(zero, 0))).toMatchObject({
      activeDurationSeconds: 0,
      leftDurationSeconds: 0,
      rightDurationSeconds: 0,
    });
    expect(
      completedNursingEditorTotals(
        updateCompletedNursingBoundary(zero, 'endedAt', new Date('2026-08-15T23:59:31.000Z')),
      ),
    ).toMatchObject({ leftDurationSeconds: 0, rightDurationSeconds: 1 });

    const half = createCompletedNursingEditorState(
      session({
        endedAt: '2026-08-15T23:59:32.000Z',
        leftDurationSeconds: 1,
        rightDurationSeconds: 1,
      }),
    );
    expect(
      completedNursingEditorTotals(
        updateCompletedNursingBoundary(half, 'endedAt', new Date('2026-08-15T23:59:33.000Z')),
      ),
    ).toMatchObject({ activeDurationSeconds: 3, leftDurationSeconds: 2, rightDurationSeconds: 1 });
  });

  it('retains the ratio basis through temporarily invalid boundary drafts', () => {
    const initial = createCompletedNursingEditorState(session());
    const invalid = updateCompletedNursingBoundary(
      initial,
      'startedAt',
      new Date('2026-08-16T00:02:00.000Z'),
    );
    expect(invalid.leftDurationSeconds).toBe(initial.leftDurationSeconds);
    expect(completedNursingEditorError(invalid, now)).toBe(
      'Nursing end time must not precede its start time.',
    );

    const recovered = updateCompletedNursingBoundary(
      invalid,
      'endedAt',
      new Date('2026-08-16T00:04:30.000Z'),
    );
    expect(completedNursingEditorError(recovered, now)).toBeNull();
    expect(completedNursingEditorTotals(recovered)).toMatchObject({
      elapsedDurationSeconds: 150,
      activeDurationSeconds: 120,
      leftDurationSeconds: 40,
      rightDurationSeconds: 80,
    });
  });

  it('retains a user split through pause-short invalidity and repeated resizes', () => {
    const initial = updateCompletedNursingLeftSeconds(
      createCompletedNursingEditorState(session()),
      60,
    );
    const invalid = updateCompletedNursingBoundary(
      initial,
      'endedAt',
      new Date('2026-08-15T23:59:20.000Z'),
    );
    expect(completedNursingEditorTotals(invalid).activeDurationSeconds).toBeNull();
    expect(invalid.leftDurationSeconds).toBe(60);

    const recovered = updateCompletedNursingBoundary(
      invalid,
      'endedAt',
      new Date('2026-08-16T00:00:09.000Z'),
    );
    const resizedAgain = updateCompletedNursingBoundary(
      recovered,
      'endedAt',
      new Date('2026-08-16T00:00:39.000Z'),
    );
    expect(completedNursingEditorTotals(recovered)).toMatchObject({
      activeDurationSeconds: 39,
      leftDurationSeconds: 26,
      rightDurationSeconds: 13,
    });
    expect(completedNursingEditorTotals(resizedAgain)).toMatchObject({
      activeDurationSeconds: 69,
      leftDurationSeconds: 46,
      rightDurationSeconds: 23,
    });
  });

  it('preserves explicit Last with two sides and announces deterministic zero-side handling', () => {
    const initial = createCompletedNursingEditorState(session());
    const both = updateCompletedNursingLeftSeconds(initial, 80);
    expect(both.lastBreastUsed).toBe('right');
    expect(both.lastAdjustmentAnnouncement).toBeNull();

    const onlyLeft = updateCompletedNursingLeftSeconds(initial, 90);
    expect(onlyLeft.lastBreastUsed).toBe('left');
    expect(onlyLeft.lastAdjustmentAnnouncement).toBe(
      'Last changed to Left because Right is now zero.',
    );

    const onlyRight = updateCompletedNursingLeftSeconds(initial, 0);
    expect(onlyRight.lastBreastUsed).toBe('right');
    expect(onlyRight.lastAdjustmentAnnouncement).toBe(
      'Right remains Last because Left is now zero.',
    );
  });

  it('normalizes an existing zero-side record into an explicit, announced correction proposal', () => {
    const initial = createCompletedNursingEditorState(
      session({ leftDurationSeconds: 90, rightDurationSeconds: 0, lastBreastUsed: 'right' }),
    );
    expect(initial.lastBreastUsed).toBe('left');
    expect(initial.lastAdjustmentAnnouncement).toBe(
      'Last changed to Left because Right is now zero.',
    );
    expect(completedNursingEditorError(initial, now)).toBeNull();
  });

  it('validates whole seconds, future time, reversed bounds, preserved pause, and split bounds', () => {
    const initial = createCompletedNursingEditorState(session());
    expect(
      completedNursingEditorError(
        { ...initial, startedAt: new Date('2026-08-15T23:59:00.500Z') },
        now,
      ),
    ).toContain('whole-second');
    expect(
      completedNursingEditorError(
        { ...initial, endedAt: new Date('2026-08-16T02:00:00.000Z') },
        now,
      ),
    ).toContain('future');
    expect(
      completedNursingEditorError(
        { ...initial, startedAt: new Date('2026-08-16T00:02:00.000Z') },
        now,
      ),
    ).toContain('must not precede');
    expect(
      completedNursingEditorError(
        {
          ...initial,
          startedAt: new Date('2026-08-15T23:59:50.000Z'),
          endedAt: new Date('2026-08-16T00:00:10.000Z'),
        },
        now,
      ),
    ).toContain('preserved pause');
    expect(completedNursingEditorError({ ...initial, leftDurationSeconds: 91 }, now)).toContain(
      'available active duration',
    );
  });

  it('emits an exact domain correction without exposing an editable Right value', () => {
    const initial = createCompletedNursingEditorState(session());
    const edited = updateCompletedNursingLeftSeconds(initial, 25);
    expect(completedNursingCorrectionForSave(edited, now)).toEqual({
      startedAt: new Date('2026-08-15T23:59:00.000Z'),
      endedAt: new Date('2026-08-16T00:01:00.000Z'),
      leftDurationSeconds: 25,
    });
  });

  it('owns its source snapshot and clones Date values at editor boundaries', () => {
    const source = session();
    const initial = createCompletedNursingEditorState(source);
    source.totalPauseDurationSeconds = 0;
    source.lastBreastUsed = 'left';
    expect(initial.session).toMatchObject({
      totalPauseDurationSeconds: 30,
      lastBreastUsed: 'right',
    });
    expect(Object.isFrozen(initial.session)).toBe(true);

    const boundary = new Date('2026-08-16T00:02:00.000Z');
    const edited = updateCompletedNursingBoundary(initial, 'endedAt', boundary);
    boundary.setTime(new Date('2026-08-16T00:03:00.000Z').getTime());
    expect(edited.endedAt.toISOString()).toBe('2026-08-16T00:02:00.000Z');

    const correction = completedNursingCorrectionForSave(edited, now);
    correction.startedAt.setTime(new Date('2026-08-15T00:00:00.000Z').getTime());
    correction.endedAt.setTime(new Date('2026-08-15T00:00:00.000Z').getTime());
    expect(edited.startedAt.toISOString()).toBe('2026-08-15T23:59:00.000Z');
    expect(edited.endedAt.toISOString()).toBe('2026-08-16T00:02:00.000Z');
  });
});

function session(overrides: Partial<NursingSession> = {}): NursingSession {
  return {
    id: 'nursing-session',
    childId: 'child-arthur',
    startedAt: '2026-08-15T23:59:00.000Z',
    endedAt: '2026-08-16T00:01:00.000Z',
    status: 'completed',
    leftDurationSeconds: 30,
    rightDurationSeconds: 60,
    totalPauseDurationSeconds: 30,
    activeSide: null,
    activeSideStartedAt: null,
    pauseStartedAt: null,
    lastBreastUsed: 'right',
    timezone: 'Europe/Lisbon',
    createdBy: 'caregiver-paloma',
    updatedBy: 'caregiver-paloma',
    version: 3,
    deletedAt: null,
    ...overrides,
  };
}
