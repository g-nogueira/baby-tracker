const COMPACT_GAP = 2;
const SPACIOUS_GAP = 26;
const MAX_ACTION_WIDTH = 108;
const MAX_CIRCLE_SIZE = 56;
const MIN_CIRCLE_SIZE = 44;

export interface HomeQuickActionsLayout {
  actionWidth: number;
  circleSize: number;
  gap: number;
}

/** Fits all Home slots in one row while preserving larger two-action targets. */
export function homeQuickActionsLayout(
  containerWidth: number,
  actionCount: number,
): HomeQuickActionsLayout {
  const count = Math.max(1, actionCount);
  const gap = count <= 2 ? SPACIOUS_GAP : COMPACT_GAP;
  const usableWidth = Math.max(0, containerWidth - gap * (count - 1));
  const actionWidth = Math.max(MIN_CIRCLE_SIZE, Math.min(MAX_ACTION_WIDTH, usableWidth / count));
  return {
    actionWidth,
    circleSize: Math.min(
      MAX_CIRCLE_SIZE,
      Math.min(actionWidth, Math.max(MIN_CIRCLE_SIZE, actionWidth - 4)),
    ),
    gap,
  };
}
