export const syncOperations = [
  'http.read',
  'http.write',
  'http.remove',
  'sync.read',
  'sync.save',
  'sync.verify',
  'sync.review',
] as const;

export const syncOutcomes = [
  'ok',
  'pending',
  'auth',
  'network',
  'rate-limit',
  'invalid',
  'conflict',
  'uncertain',
] as const;

export type SyncOperation = (typeof syncOperations)[number];
export type SyncOutcome = (typeof syncOutcomes)[number];
export type FinishSync = (outcome: SyncOutcome, httpStatus?: number) => void;

/** Only fixed operations, outcomes and numeric status codes cross this boundary. */
export interface SyncTelemetry {
  start(operation: SyncOperation): FinishSync;
}

export function observeSync(
  telemetry: SyncTelemetry | undefined,
  operation: SyncOperation,
): FinishSync | undefined {
  try {
    const finish = telemetry?.start(operation);
    if (!finish) return undefined;
    return (outcome, status) => {
      try {
        finish(outcome, status);
      } catch {
        // A failing diagnostics sink cannot change a care operation's result.
      }
    };
  } catch {
    return undefined;
  }
}
