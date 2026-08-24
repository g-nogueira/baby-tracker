export type LiveControllerIdentity =
  | { kind: 'sleep'; sessionId: string }
  | { kind: 'nursing'; sessionId: string };

export type NursingDrawerCommand = { kind: 'open'; sessionId?: string } | { kind: 'dismiss' };

export interface NursingDrawerDecision {
  drawerOpen: boolean;
  clearError: boolean;
  canonicalMutation: null;
}

/** Deduplicates repository counts because both repositories read the same global outbox. */
export function combinedPendingOperationCount(
  sleepPendingCount: number,
  nursingPendingCount: number,
): number {
  return Math.max(sleepPendingCount, nursingPendingCount);
}

/** Preserves stable controller order and exact aggregate identities for concurrent timers. */
export function liveControllerIdentities(
  sleepSessionId: string | null,
  nursingSessionId: string | null,
): readonly LiveControllerIdentity[] {
  const identities: LiveControllerIdentity[] = [];
  if (sleepSessionId !== null) identities.push({ kind: 'sleep', sessionId: sleepSessionId });
  if (nursingSessionId !== null) {
    identities.push({ kind: 'nursing', sessionId: nursingSessionId });
  }
  return identities;
}

/** Keeps drawer visibility local and rejects stale exact-session controller requests. */
export function decideNursingDrawerCommand(
  activeSessionId: string | null,
  command: NursingDrawerCommand,
): NursingDrawerDecision {
  if (command.kind === 'dismiss') {
    return { drawerOpen: false, clearError: false, canonicalMutation: null };
  }
  if (command.sessionId !== undefined && command.sessionId !== activeSessionId) {
    return { drawerOpen: false, clearError: false, canonicalMutation: null };
  }
  return { drawerOpen: true, clearError: true, canonicalMutation: null };
}
