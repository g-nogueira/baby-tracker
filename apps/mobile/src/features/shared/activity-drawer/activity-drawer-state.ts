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

/**
 * Determines the initial state of the activity drawer for a given mode.
 *
 * @param mode - The activity drawer mode
 * @returns `expanded` for edit mode, `collapsed` otherwise
 */
export function initialActivityDrawerState(mode: ActivityDrawerMode): ActivityDrawerState {
  return mode === 'edit' ? 'expanded' : 'collapsed';
}

/**
 * Determines the drawer transition for a vertical gesture.
 *
 * @param state - The drawer's current state
 * @param gesture - The gesture's vertical displacement and velocity
 * @returns The transition to expand, collapse, dismiss, or settle the drawer
 */
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

/**
 * Determines the drawer transition caused by pressing its handle.
 *
 * @param state - The current drawer state
 * @returns `expand` when the drawer is collapsed, otherwise `collapse`
 */
export function decideActivityDrawerHandlePress(
  state: ActivityDrawerState,
): ActivityDrawerDecision {
  return state === 'collapsed' ? 'expand' : 'collapse';
}

/**
 * Determines the drawer transition for an accessibility action.
 *
 * @param state - The drawer's current state
 * @param actionName - The accessibility action to apply
 * @returns The transition decision for the action
 */
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
