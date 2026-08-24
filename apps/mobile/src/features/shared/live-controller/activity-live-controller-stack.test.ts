import { describe, expect, it } from 'vitest';

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
});
