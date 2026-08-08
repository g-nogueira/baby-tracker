export type UtcInstant = string;

export type SleepSessionStatus = 'active' | 'completed';

export interface SleepPhase {
  id: string;
  sleepSessionId: string;
  kind: 'asleep' | 'awake';
  startedAt: UtcInstant;
  endedAt: UtcInstant | null;
  createdBy: string;
  updatedBy: string;
  version: number;
  deletedAt: UtcInstant | null;
}

export interface NapSession {
  id: string;
  childId: string;
  kind: 'nap';
  startedAt: UtcInstant;
  endedAt: UtcInstant | null;
  status: SleepSessionStatus;
  timezone: string;
  createdBy: string;
  updatedBy: string;
  version: number;
  deletedAt: UtcInstant | null;
  phase: SleepPhase;
}

export type SyncAction = 'start_nap' | 'stop_nap' | 'delete_sleep_session';

export interface SyncOperation {
  operationId: string;
  entityId: string;
  entityType: 'sleep_session';
  action: SyncAction;
  baseVersion: number | null;
  clientOccurredAt: UtcInstant;
  clientTimezone: string;
  payload: Readonly<Record<string, string>>;
}

export interface NapMutation {
  session: NapSession;
  operation: SyncOperation;
}

export interface MutationContext {
  caregiverId: string;
  childId: string;
  now: Date;
  timezone: string;
  newId: () => string;
}
