import { describe, expect, it } from 'vitest';

import {
  nursingSplitValueForAccessibilityAction,
  nursingSplitValueForDrag,
  nursingSplitValueForPosition,
} from './nursing-split-slider-state';

describe('Nursing split slider state', () => {
  it('maps track positions to clamped whole seconds', () => {
    expect(nursingSplitValueForPosition(0, 200, 90)).toBe(0);
    expect(nursingSplitValueForPosition(100, 200, 90)).toBe(45);
    expect(nursingSplitValueForPosition(250, 200, 90)).toBe(90);
    expect(nursingSplitValueForPosition(-20, 200, 90)).toBe(0);
  });

  it('applies drags from the captured starting value', () => {
    expect(nursingSplitValueForDrag(30, 50, 200, 100)).toBe(55);
    expect(nursingSplitValueForDrag(30, -200, 200, 100)).toBe(0);
    expect(nursingSplitValueForDrag(80, 200, 200, 100)).toBe(100);
  });

  it('uses bounded accessibility increments without requiring one action per second', () => {
    expect(nursingSplitValueForAccessibilityAction(100, 'increment', 3_600)).toBe(136);
    expect(nursingSplitValueForAccessibilityAction(5, 'decrement', 3_600)).toBe(0);
    expect(nursingSplitValueForAccessibilityAction(3_590, 'increment', 3_600)).toBe(3_600);
    expect(nursingSplitValueForAccessibilityAction(0, 'increment', 20)).toBe(1);
  });

  it('fails closed for unusable geometry and duration', () => {
    expect(nursingSplitValueForPosition(10, 0, 90)).toBe(0);
    expect(nursingSplitValueForPosition(10, 100, 0)).toBe(0);
    expect(nursingSplitValueForDrag(30, 10, 0, 90)).toBe(30);
    expect(nursingSplitValueForAccessibilityAction(10, 'increment', 0)).toBe(0);
  });
});
