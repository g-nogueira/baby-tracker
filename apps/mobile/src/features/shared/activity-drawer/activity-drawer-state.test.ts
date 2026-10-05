import { describe, expect, it } from 'vitest';

import {
  type ActivityDrawerState,
  activityDrawerBottomPadding,
  activityDrawerScrollableContentMaxHeight,
  decideActivityDrawerAccessibilityAction,
  decideActivityDrawerGesture,
  decideActivityDrawerHandlePress,
  initialActivityDrawerState,
  shouldActivityDrawerClaimSurfaceGesture,
} from './activity-drawer-state';

describe('activity drawer state', () => {
  it('keeps controls above the bottom safe area', () => {
    expect(activityDrawerBottomPadding(0)).toBe(30);
    expect(activityDrawerBottomPadding(34)).toBe(46);
  });

  it('bounds tall opt-in content below both safe areas while preserving a usable viewport', () => {
    expect(activityDrawerScrollableContentMaxHeight(667, 20, 0)).toBe(551);
    expect(activityDrawerScrollableContentMaxHeight(667, 47, 34)).toBe(508);
    expect(activityDrawerScrollableContentMaxHeight(160, 47, 34)).toBe(120);
  });

  it('opens create and active drawers collapsed, and edit drawers expanded', () => {
    expect(initialActivityDrawerState('create')).toBe('collapsed');
    expect(initialActivityDrawerState('active')).toBe('collapsed');
    expect(initialActivityDrawerState('edit')).toBe('expanded');
  });

  it('claims vertical surface drags without stealing horizontal gestures', () => {
    expect(shouldActivityDrawerClaimSurfaceGesture('collapsed', true, { dx: 0, dy: -7 })).toBe(
      true,
    );
    expect(shouldActivityDrawerClaimSurfaceGesture('collapsed', true, { dx: 0, dy: 5 })).toBe(
      false,
    );
    expect(shouldActivityDrawerClaimSurfaceGesture('collapsed', true, { dx: 8, dy: 7 })).toBe(
      false,
    );
  });

  it('leaves expanded scrollable content to its ScrollView', () => {
    expect(shouldActivityDrawerClaimSurfaceGesture('expanded', true, { dx: 0, dy: -40 })).toBe(
      false,
    );
    expect(shouldActivityDrawerClaimSurfaceGesture('expanded', false, { dx: 0, dy: 40 })).toBe(
      true,
    );
  });

  it('expands a collapsed drawer on an upward drag', () => {
    expect(decideActivityDrawerGesture('collapsed', { dy: -39, vy: 0 })).toBe('expand');
    expect(decideActivityDrawerGesture('collapsed', { dy: 0, vy: -0.81 })).toBe('expand');
  });

  it('dismisses a collapsed drawer on a downward drag', () => {
    expect(decideActivityDrawerGesture('collapsed', { dy: 73, vy: 0 })).toBe('dismiss');
    expect(decideActivityDrawerGesture('collapsed', { dy: 0, vy: 1.16 })).toBe('dismiss');
  });

  it('lets an active drawer minimize without encoding a stop transition', () => {
    const activeState = initialActivityDrawerState('active');

    expect(activeState).toBe('collapsed');
    expect(decideActivityDrawerGesture(activeState, { dy: 73, vy: 0 })).toBe('dismiss');
  });

  it('collapses an expanded drawer before a later downward drag can dismiss it', () => {
    let state: ActivityDrawerState = 'expanded';
    const firstDecision = decideActivityDrawerGesture(state, { dy: 73, vy: 0 });
    expect(firstDecision).toBe('collapse');

    state = 'collapsed';
    expect(decideActivityDrawerGesture(state, { dy: 73, vy: 0 })).toBe('dismiss');
  });

  it('settles when a gesture does not cross a threshold', () => {
    expect(decideActivityDrawerGesture('collapsed', { dy: -20, vy: -0.2 })).toBe('settle');
    expect(decideActivityDrawerGesture('expanded', { dy: 20, vy: 0.2 })).toBe('settle');
    expect(decideActivityDrawerGesture('expanded', { dy: -50, vy: -1 })).toBe('settle');
  });

  it('toggles expansion when the handle is tapped', () => {
    expect(decideActivityDrawerHandlePress('collapsed')).toBe('expand');
    expect(decideActivityDrawerHandlePress('expanded')).toBe('collapse');
  });

  it('maps adjustable accessibility actions to the same state transitions', () => {
    expect(decideActivityDrawerAccessibilityAction('collapsed', 'increment')).toBe('expand');
    expect(decideActivityDrawerAccessibilityAction('expanded', 'increment')).toBe('settle');
    expect(decideActivityDrawerAccessibilityAction('expanded', 'decrement')).toBe('collapse');
    expect(decideActivityDrawerAccessibilityAction('collapsed', 'decrement')).toBe('dismiss');
    expect(decideActivityDrawerAccessibilityAction('collapsed', 'activate')).toBe('settle');
  });
});
