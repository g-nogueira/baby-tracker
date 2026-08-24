import { describe, expect, it } from 'vitest';

import {
  combinedPendingOperationCount,
  decideNursingDrawerCommand,
  liveControllerIdentities,
} from './nursing-home-integration-state';

describe('Nursing Home integration state', () => {
  it('keeps concurrent Sleep and Nursing controllers ordered with exact IDs', () => {
    expect(liveControllerIdentities('night-17', 'nursing-42')).toEqual([
      { kind: 'sleep', sessionId: 'night-17' },
      { kind: 'nursing', sessionId: 'nursing-42' },
    ]);
    expect(liveControllerIdentities(null, 'nursing-42')).toEqual([
      { kind: 'nursing', sessionId: 'nursing-42' },
    ]);
  });

  it('deduplicates the shared global outbox count across repository hooks', () => {
    expect(combinedPendingOperationCount(7, 7)).toBe(7);
    expect(combinedPendingOperationCount(4, 5)).toBe(5);
  });

  it('opens only the exact requested active session and dismisses without mutation', () => {
    expect(decideNursingDrawerCommand('nursing-42', { kind: 'open' })).toEqual({
      drawerOpen: true,
      clearError: true,
      canonicalMutation: null,
    });
    expect(
      decideNursingDrawerCommand('nursing-42', {
        kind: 'open',
        sessionId: 'nursing-stale',
      }),
    ).toEqual({ drawerOpen: false, clearError: false, canonicalMutation: null });
    expect(decideNursingDrawerCommand('nursing-42', { kind: 'dismiss' })).toEqual({
      drawerOpen: false,
      clearError: false,
      canonicalMutation: null,
    });
  });
});
