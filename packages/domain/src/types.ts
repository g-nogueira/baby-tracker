export type UtcInstant = string;

export type SleepSessionStatus = 'active' | 'completed';
export type SleepSessionKind = 'nap' | 'night';
export type SleepPhaseKind = 'asleep' | 'awake';

export interface SleepPhase {
  id: string;
  sleepSessionId: string;
  kind: SleepPhaseKind;
  startedAt: UtcInstant;
  endedAt: UtcInstant | null;
  createdBy: string;
  updatedBy: string;
  version: number;
  deletedAt: UtcInstant | null;
}

interface SleepSessionBase {
  id: string;
  childId: string;
  kind: SleepSessionKind;
  startedAt: UtcInstant;
  endedAt: UtcInstant | null;
  status: SleepSessionStatus;
  timezone: string;
  createdBy: string;
  updatedBy: string;
  version: number;
  deletedAt: UtcInstant | null;
}

export interface NapSession extends SleepSessionBase {
  kind: 'nap';
  phases: readonly [SleepPhase];
}

export interface NightSleepSession extends SleepSessionBase {
  kind: 'night';
  phases: readonly SleepPhase[];
}

export type SleepSession = NapSession | NightSleepSession;

export type SyncAction =
  | 'start_nap'
  | 'stop_nap'
  | 'start_night_sleep'
  | 'start_night_waking'
  | 'resume_night_sleep'
  | 'end_night_sleep'
  | 'edit_sleep_session'
  | 'delete_sleep_session'
  | 'restore_sleep_session'
  | 'delete_night_waking'
  | 'restore_night_waking';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface SyncOperation {
  operationId: string;
  entityId: string;
  entityType: 'sleep_session';
  action: SyncAction;
  baseVersion: number | null;
  clientOccurredAt: UtcInstant;
  clientTimezone: string;
  payload: Readonly<Record<string, JsonValue>>;
}

export interface SleepMutation<TSession extends SleepSession = SleepSession> {
  session: TSession;
  changedPhases: readonly SleepPhase[];
  /** Removed phase rows retained as tombstones, outside the canonical timeline. */
  retiredPhases?: readonly SleepPhase[];
  operation: SyncOperation;
}

export type NapMutation = SleepMutation<NapSession>;
export type NightSleepMutation = SleepMutation<NightSleepSession>;

export interface MutationContext {
  caregiverId: string;
  childId: string;
  now: Date;
  timezone: string;
  newId: () => string;
}
