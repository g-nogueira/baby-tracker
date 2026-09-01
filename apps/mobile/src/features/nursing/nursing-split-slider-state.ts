export type NursingSplitSliderDirection = 'increment' | 'decrement';

/** Converts a track position into a clamped whole-second split value. */
export function nursingSplitValueForPosition(
  position: number,
  trackWidth: number,
  maximumValue: number,
): number {
  if (!Number.isFinite(position) || !Number.isFinite(trackWidth) || trackWidth <= 0) return 0;
  if (!Number.isSafeInteger(maximumValue) || maximumValue <= 0) return 0;

  const ratio = clamp(position / trackWidth, 0, 1);
  return Math.round(ratio * maximumValue);
}

/** Applies a horizontal drag relative to the value captured when the drag began. */
export function nursingSplitValueForDrag(
  startingValue: number,
  dx: number,
  trackWidth: number,
  maximumValue: number,
): number {
  if (!Number.isFinite(dx) || !Number.isFinite(trackWidth) || trackWidth <= 0) {
    return clampWholeSeconds(startingValue, maximumValue);
  }
  if (!Number.isSafeInteger(maximumValue) || maximumValue <= 0) return 0;

  return clampWholeSeconds(startingValue + (dx / trackWidth) * maximumValue, maximumValue);
}

/** Moves the split by roughly one percent for an adjustable accessibility action. */
export function nursingSplitValueForAccessibilityAction(
  currentValue: number,
  direction: NursingSplitSliderDirection,
  maximumValue: number,
): number {
  if (!Number.isSafeInteger(maximumValue) || maximumValue <= 0) return 0;
  const step = Math.max(1, Math.round(maximumValue / 100));
  const delta = direction === 'increment' ? step : -step;
  return clampWholeSeconds(currentValue + delta, maximumValue);
}

function clampWholeSeconds(value: number, maximumValue: number): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(maximumValue) || maximumValue <= 0) return 0;
  return Math.round(clamp(value, 0, maximumValue));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
