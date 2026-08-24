import {
  pauseNursing,
  startNursing,
  stopNursing,
  type MutationContext,
} from '@baby-tracker/domain';
import { describe, expect, it } from 'vitest';

import { nursingDrawerControls } from './nursing-drawer-state';

describe('Nursing drawer controls', () => {
  it('offers only neutral Left and Right starts before a session exists', () => {
    expect(nursingDrawerControls(null)).toEqual({
      mode: 'create',
      startSides: ['left', 'right'],
    });
  });

  it('offers the gapless opposite-side switch, Pause, and Stop while active', () => {
    const left = startNursing('left', context('2026-08-15T10:00:00.000Z')).session;
    const right = startNursing('right', context('2026-08-15T10:00:00.000Z')).session;

    expect(nursingDrawerControls(left)).toEqual({
      mode: 'active',
      switchTo: 'right',
      canPause: true,
      canStop: true,
    });
    expect(nursingDrawerControls(right)).toEqual({
      mode: 'active',
      switchTo: 'left',
      canPause: true,
      canStop: true,
    });
  });

  it('offers either resume side and Stop while paused, without active Delete', () => {
    const active = startNursing('left', context('2026-08-15T10:00:00.000Z')).session;
    const paused = pauseNursing(active, context('2026-08-15T10:01:00.000Z')).session;

    expect(nursingDrawerControls(paused)).toEqual({
      mode: 'paused',
      resumeSides: ['left', 'right'],
      canStop: true,
    });
    expect(nursingDrawerControls(paused)).not.toHaveProperty('canDelete');
  });

  it('routes completed records away from live controls to the issue #14 editor', () => {
    const active = startNursing('left', context('2026-08-15T10:00:00.000Z')).session;
    const completed = stopNursing(active, context('2026-08-15T10:01:00.000Z')).session;

    expect(() => nursingDrawerControls(completed)).toThrow(
      'Completed Nursing controls belong to the completed-session editor.',
    );
  });
});

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
