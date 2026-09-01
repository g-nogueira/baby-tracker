import type { NursingSession } from '@baby-tracker/domain';

/** Keeps only visible completed records while preserving repository chronology. */
export function completedNursingHistory(sessions: readonly NursingSession[]): NursingSession[] {
  return sessions.filter((session) => session.status === 'completed' && session.deletedAt === null);
}

/** Resolves the exact visible completed record selected by a history interaction. */
export function completedNursingRecordById(
  sessions: readonly NursingSession[],
  sessionId: string,
): NursingSession | null {
  return (
    sessions.find(
      (session) =>
        session.id === sessionId && session.status === 'completed' && session.deletedAt === null,
    ) ?? null
  );
}
