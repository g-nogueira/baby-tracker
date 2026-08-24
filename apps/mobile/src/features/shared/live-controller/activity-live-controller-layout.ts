export const LIVE_CONTROLLER_MIN_HEIGHT = 68;
export const LIVE_CONTROLLER_STACK_GAP = 10;

/** Models the height that the native stack reports after controller text wraps. */
export function expectedLiveControllerStackHeight(controllerHeights: readonly number[]): number {
  return controllerHeights.reduce(
    (height, controllerHeight, index) =>
      height +
      Math.max(LIVE_CONTROLLER_MIN_HEIGHT, controllerHeight) +
      (index === 0 ? 0 : LIVE_CONTROLLER_STACK_GAP),
    0,
  );
}

/** Returns the minimum measured height for a given number of controller rows. */
export function minimumLiveControllerStackHeight(controllerCount: number): number {
  return expectedLiveControllerStackHeight(
    Array.from({ length: Math.max(0, controllerCount) }, () => LIVE_CONTROLLER_MIN_HEIGHT),
  );
}
