import { describe, expect, it } from 'vitest';

import {
  expectedLiveControllerStackHeight,
  LIVE_CONTROLLER_MIN_HEIGHT,
  minimumLiveControllerStackHeight,
} from './activity-live-controller-layout';
import {
  liveControllerBottomOffset,
  liveControllerReservedSpace,
} from './activity-live-controller-stack-state';

describe('activity live-controller stack', () => {
  it('clears the safe area and raises above Undo', () => {
    expect(liveControllerBottomOffset(0, false)).toBe(16);
    expect(liveControllerBottomOffset(34, false)).toBe(42);
    expect(liveControllerBottomOffset(34, true)).toBe(112);
  });

  it('reserves the measured height of one or more stacked controllers', () => {
    expect(liveControllerReservedSpace(34, false, 68)).toBe(126);
    expect(liveControllerReservedSpace(34, false, 146)).toBe(204);
    expect(liveControllerReservedSpace(34, true, 68)).toBe(196);
  });

  it('grows reserved space when wrapped or accessibility-sized controller copy grows', () => {
    const wrappedControllerHeight = 96;
    const measuredHeight = expectedLiveControllerStackHeight([
      LIVE_CONTROLLER_MIN_HEIGHT,
      wrappedControllerHeight,
    ]);

    expect(measuredHeight).toBe(174);
    expect(liveControllerReservedSpace(34, false, measuredHeight)).toBe(232);
  });

  it('derives a safe first-layout fallback for concurrent controller rows', () => {
    expect(minimumLiveControllerStackHeight(1)).toBe(68);
    expect(minimumLiveControllerStackHeight(2)).toBe(146);
    expect(liveControllerReservedSpace(34, false, minimumLiveControllerStackHeight(2))).toBe(204);
  });
});
