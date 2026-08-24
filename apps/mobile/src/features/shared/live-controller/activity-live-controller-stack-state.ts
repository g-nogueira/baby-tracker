export function liveControllerBottomOffset(bottomInset: number, raised: boolean): number {
  return Math.max(16, bottomInset + 8) + (raised ? 70 : 0);
}

/** Returns the bottom content space occupied by the complete controller stack. */
export function liveControllerReservedSpace(
  bottomInset: number,
  raised: boolean,
  stackHeight: number,
): number {
  return liveControllerBottomOffset(bottomInset, raised) + Math.max(0, stackHeight) + 16;
}
