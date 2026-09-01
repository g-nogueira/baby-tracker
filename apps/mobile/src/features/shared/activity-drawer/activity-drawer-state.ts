export type ActivityDrawerMode = 'create' | 'active' | 'edit';

export type ActivityDrawerState = 'collapsed' | 'expanded';

export type ActivityDrawerDecision = 'settle' | 'expand' | 'collapse' | 'dismiss';

export interface ActivityDrawerGesture {
  dy: number;
  vy: number;
}

export interface ActivityDrawerSurfaceGesture {
  dx: number;
  dy: number;
}

/** Returns whether the drawer surface should own a vertical drag. */
export function shouldActivityDrawerClaimSurfaceGesture(
  state: ActivityDrawerState,
  scrollContent: boolean,
  gesture: ActivityDrawerSurfaceGesture,
): boolean {
  const isVerticalDrag = Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx);

  if (!isVerticalDrag) return false;

  return state === 'collapsed' || !scrollContent;
}

const EXPAND_DISTANCE = -38;
const EXPAND_VELOCITY = -0.8;
const DISMISS_DISTANCE = 72;
const DISMISS_VELOCITY = 1.15;

/** Keeps drawer content above device gesture/home-indicator insets. */
export function activityDrawerBottomPadding(bottomInset: number): number {
  return Math.max(30, bottomInset + 12);
}

/** Bounds opt-in scroll content below the top safe area, handle, and bottom inset. */
export function activityDrawerScrollableContentMaxHeight(
  viewportHeight: number,
  topInset: number,
  bottomInset: number,
): number {
  const topClearance = Math.max(12, topInset + 8);
  const handleAndSpacing = 58;
  const available =
    viewportHeight - topClearance - handleAndSpacing - activityDrawerBottomPadding(bottomInset);
  return Math.max(120, Math.floor(available));
}

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
