export type ActivityDrawerMode = 'create' | 'active' | 'edit';

export type ActivityDrawerState = 'collapsed' | 'expanded';

export type ActivityDrawerDecision = 'settle' | 'expand' | 'collapse' | 'dismiss';

export interface ActivityDrawerGesture {
  dy: number;
  vy: number;
}

const EXPAND_DISTANCE = -38;
const EXPAND_VELOCITY = -0.8;
const DISMISS_DISTANCE = 72;
const DISMISS_VELOCITY = 1.15;

export function initialActivityDrawerState(mode: ActivityDrawerMode): ActivityDrawerState {
  return mode === 'edit' ? 'expanded' : 'collapsed';
}

export function decideActivityDrawerGesture(
  state: ActivityDrawerState,
  gesture: ActivityDrawerGesture,
): ActivityDrawerDecision {
  if (gesture.dy < EXPAND_DISTANCE || gesture.vy < EXPAND_VELOCITY) {
    return state === 'collapsed' ? 'expand' : 'settle';
  }

  if (gesture.dy > DISMISS_DISTANCE || gesture.vy > DISMISS_VELOCITY) {
    return state === 'expanded' ? 'collapse' : 'dismiss';
  }

  return 'settle';
}

export function decideActivityDrawerHandlePress(
  state: ActivityDrawerState,
): ActivityDrawerDecision {
  return state === 'collapsed' ? 'expand' : 'collapse';
}

export function decideActivityDrawerAccessibilityAction(
  state: ActivityDrawerState,
  actionName: string,
): ActivityDrawerDecision {
  if (actionName === 'increment') {
    return state === 'collapsed' ? 'expand' : 'settle';
  }

  if (actionName === 'decrement') {
    return state === 'expanded' ? 'collapse' : 'dismiss';
  }

  return 'settle';
}
