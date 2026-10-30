/** Provider-neutral application contract. Transport payloads stay private; IDs/revisions are opaque. */
export type Breast = 'LEFT' | 'RIGHT';
export type DiaperType = 'dry' | 'wet' | 'dirty' | 'mixed';
export type SleepMethod =
  | 'in-bed'
  | 'nursing'
  | 'held'
  | 'next-to-me'
  | 'bottle'
  | 'stroller'
  | 'car'
  | 'swing';
export type WakeMood = 'bad' | 'neutral' | 'good';
/** Portable annotations; providers translate these values into their own schema. */
export interface ActivityDetails {
  settling?: ('took-long' | 'upset')[];
  sleepMethod?: SleepMethod | null;
  wakeMood?: WakeMood | null;
  comment?: string;
}
export type CareKind =
  | 'bedtime'
  | 'wake-up'
  | 'nap'
  | 'night-waking'
  | 'nursing'
  | 'diaper'
  | 'medicine';
export interface CareProfile {
  id: string;
  name: string;
}
export interface ActivityReference {
  id: string;
  revision: string;
}
interface ActivityBase extends ActivityReference {
  details?: ActivityDetails;
  kind: CareKind;
  /** Canonical UTC instants; the selected IANA display zone belongs to the service/session. */
  startedAt: string;
  endedAt: string | null;
  status: 'active' | 'paused' | 'completed';
  /** Unknown for imported records that expose only a numeric UTC offset. */
  originTimezone?: string | null;
}
export interface NursingActivity extends ActivityBase {
  kind: 'nursing';
  leftSeconds: number;
  rightSeconds: number;
  lastBreast: Breast | null;
  /** Side/pause totals at this UTC instant; running Nursing accrues on Last after it. */
  measuredAt: string;
  pauseSeconds: number;
}
/** Opaque pause references are valid only for the activity's reviewed revision. */
export interface SleepPause {
  id: string;
  startedAt: string;
  endedAt: string | null;
}
export interface SleepPauseDraft {
  id?: string;
  startedAt: string;
  endedAt: string | null;
}
export interface SleepActivity extends ActivityBase {
  kind: 'nap' | 'night-waking';
  /** Missing only for providers that expose aggregate pause totals. */
  pauses?: readonly SleepPause[];
  /** Pause total at this UTC instant; paused sleep does not accrue after it. */
  measuredAt: string;
  pauseSeconds: number;
}
export interface PointActivity extends ActivityBase {
  /** Bedtime may span a settling routine; its end is the start of night sleep. */
  kind: 'bedtime' | 'wake-up' | 'diaper' | 'medicine';
  diaperType?: DiaperType;
  note?: string;
}
export type CareActivity = NursingActivity | SleepActivity | PointActivity;
export interface CareIssue {
  id: string;
  message: string;
  blocksWrites: boolean;
}
export interface CareSnapshot {
  activities: CareActivity[];
  issues: CareIssue[];
}
export const emptySnapshot = (): CareSnapshot => ({ activities: [], issues: [] });
export type NursingCommand =
  | { kind: 'switch' | 'resume'; side: Breast }
  | { kind: 'pause' | 'stop' };
export type PastActivity = (
  | { kind: 'nap' | 'night-waking'; startedAt: string; endedAt: string }
  | { kind: 'bedtime'; startedAt: string; endedAt?: string }
  | { kind: 'wake-up'; startedAt: string }
  | { kind: 'diaper'; startedAt: string; diaperType: DiaperType }
  | { kind: 'medicine'; startedAt: string; note: string }
  | {
      kind: 'nursing';
      startedAt: string;
      endedAt: string;
      leftSeconds: number;
      lastBreast: Breast;
    }
) & { details?: ActivityDetails };
export type CareCommand =
  | {
      type: 'edit-sleep';
      expected: ActivityReference;
      startedAt: string;
      endedAt: string | null;
      pauses: readonly SleepPauseDraft[];
      details?: ActivityDetails;
    }
  | { type: 'start-nursing'; side: Breast; at: string }
  | { type: 'change-nursing'; expected: ActivityReference; command: NursingCommand }
  | {
      type: 'correct-nursing';
      expected: ActivityReference;
      startedAt: string;
      endedAt: string;
      leftSeconds: number;
      lastBreast: Breast;
    }
  | { type: 'start-nap' | 'bedtime'; at: string; details?: ActivityDetails }
  | {
      type: 'wake-up' | 'start-night-waking';
      expected: ActivityReference;
      at: string;
      details?: ActivityDetails;
    }
  | {
      type: 'stop-nap' | 'fall-asleep' | 'continue-nap' | 'pause-nap' | 'resume-nap';
      expected: ActivityReference;
      at: string;
      details?: ActivityDetails;
    }
  | {
      type: 'edit-activity';
      expected: ActivityReference;
      startedAt: string;
      endedAt?: string;
      diaperType?: DiaperType;
      note?: string;
      details?: ActivityDetails;
    }
  | { type: 'record-past'; activity: PastActivity }
  | { type: 'remove-activity'; expected: ActivityReference };

/** Replace this port to use our own API; revisions are opaque optimistic concurrency tokens. */
export interface CareService {
  readonly needsRefresh: boolean;
  current(profileId: string): Promise<CareSnapshot>;
  /** Includes neighboring days needed to resolve cycles spanning midnight. */
  history(profileId: string, date: string): Promise<CareSnapshot>;
  reconcile(profileId: string): Promise<CareSnapshot>;
  /** Resolves only after the authoritative store confirms the requested change. */
  execute(profileId: string, command: CareCommand): Promise<void>;
}
export interface CareSession {
  readonly selectedProfileId: string | null;
  restore(): Promise<boolean>;
  sendCode(email: string): Promise<void>;
  login(email: string, code: string): Promise<void>;
  profiles(): Promise<CareProfile[]>;
  selectProfile(id: string): Promise<void>;
  signOut(): Promise<void>;
}
export interface CareProvider {
  name: string;
  session: CareSession;
  care: CareService;
}
export class CareServiceError extends Error {
  constructor(
    public readonly code: 'auth' | 'network' | 'rate-limit' | 'invalid' | 'conflict' | 'uncertain',
    message: string,
  ) {
    super(message);
    this.name = 'CareServiceError';
  }
}
